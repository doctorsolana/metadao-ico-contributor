import type {
  Connection,
  AddressLookupTableAccount,
  Commitment,
  PublicKey,
  TransactionConfirmationStrategy,
  TransactionInstruction,
} from '@solana/web3.js'
import {
  ComputeBudgetProgram,
  TransactionMessage,
  VersionedTransaction,
} from '@solana/web3.js'
import type { WalletContextState } from '@solana/wallet-adapter-react'
import { AnchorError } from '@coral-xyz/anchor'

export interface SendTransactionOptions {
  confirmation?: Commitment
  lookupTable?: PublicKey[]
  priorityFee?: number
  computeUnitLimitMargin?: number
  computeUnits?: number
  blockhashCommitment?: Commitment
  label?: string
}

function getErrorLogs(error: unknown): string[] | null {
  if (
    error &&
    typeof error === 'object' &&
    'logs' in error &&
    Array.isArray((error as any).logs)
  ) {
    return (error as any).logs
  }
  return null
}

const cleanProgramLog = (log: string) =>
  log.replace(/^Program log:\s*/, '').replace(/^Error:\s*/, '')

function parseErrorMessage(logs: string[], fallback: string): string {
  if (!logs.length) return fallback
  try {
    const parsed = AnchorError.parse(logs as any)
    if (parsed) {
      const match = parsed.message.match(/Error Message:\s*(.*)$/)
      return match ? match[1] : parsed.message
    }
  } catch {}

  const splErrors = logs.filter(
    (l) => l.startsWith('Transfer:') || l.includes('Error: insufficient funds'),
  )
  if (splErrors.length) {
    return splErrors.map(cleanProgramLog).join('\n')
  }

  const generic = logs.filter((l) => !l.startsWith('Program '))
  if (generic.length) return generic.join('\n')

  return fallback
}

export async function sendSmartTransaction(
  connection: Connection,
  wallet: WalletContextState,
  instructions: TransactionInstruction | TransactionInstruction[],
  opts: SendTransactionOptions = {},
): Promise<string> {
  console.log('[sendSmartTransaction] Starting...')

  if (!wallet.publicKey || !wallet.signTransaction) {
    throw new Error('Wallet not connected or does not support signTransaction')
  }

  const {
    confirmation = 'processed',
    lookupTable = [],
    priorityFee = 50_000,
    computeUnitLimitMargin = 1.1,
    computeUnits,
    blockhashCommitment = 'processed',
  } = opts

  const list = Array.isArray(instructions) ? instructions : [instructions]
  const resolvedInstructions = await Promise.all(list)

  console.log('[sendSmartTransaction] Instructions:', resolvedInstructions)

  const lookupTables = (
    await Promise.all(
      lookupTable.map(async (key) => {
        const resp = await connection.getAddressLookupTable(key)
        return resp?.value
      }),
    )
  ).filter(Boolean) as AddressLookupTableAccount[]

  console.log('[sendSmartTransaction] Lookup Tables:', lookupTables)

  const buildTransaction = (units: number, recentBlockhash: string) => {
    console.log('[sendSmartTransaction] Building transaction...')
    const message = new TransactionMessage({
      payerKey: wallet.publicKey!,
      recentBlockhash,
      instructions: [
        ...(priorityFee > 0
          ? [
              ComputeBudgetProgram.setComputeUnitPrice({
                microLamports: priorityFee,
              }),
            ]
          : []),
        ComputeBudgetProgram.setComputeUnitLimit({ units }),
        ...resolvedInstructions,
      ],
    }).compileToV0Message(lookupTables)

    const versionedTx = new VersionedTransaction(message)
    console.log('[sendSmartTransaction] Built Versioned Transaction:', versionedTx)
    return versionedTx
  }

  let finalComputeUnits = computeUnits
  if (!finalComputeUnits) {
    console.log(
      '[sendSmartTransaction] Simulating transaction for compute units...',
    )
    const { blockhash: placeholderBlockhash } =
      await connection.getLatestBlockhash({ commitment: blockhashCommitment })
    const simulationTx = buildTransaction(1_400_000, placeholderBlockhash)

    try {
      const simulation = await connection.simulateTransaction(simulationTx, {
        replaceRecentBlockhash: true,
        sigVerify: false,
      })
      console.log('[sendSmartTransaction] Simulation result:', simulation)

      if (simulation.value.logs?.length) {
        const groupLabel = `[Simulation logs]${opts.label ? ` ${opts.label}` : ''}`
        try {
          console.groupCollapsed(groupLabel)
        } catch {}
        simulation.value.logs.forEach((l) => console.log(l))
        try {
          console.groupEnd()
        } catch {}
      }

      if (simulation.value.err) {
        console.error(
          '[sendSmartTransaction] Simulation error:',
          simulation.value.err,
        )
        const logs = simulation.value.logs ?? []
        const message = parseErrorMessage(
          logs,
          (simulation.value.err as any)?.message || 'Simulation failed',
        )
        const e = new Error(message)
        ;(e as any).logs = logs
        throw e
      }
      if (!simulation.value.unitsConsumed) {
        const e = new Error(
          'Simulation consumed 0 units or did not report unitsConsumed.',
        )
        ;(e as any).logs = simulation.value.logs ?? []
        throw e
      }
      finalComputeUnits = Math.floor(
        simulation.value.unitsConsumed * computeUnitLimitMargin,
      )
      console.log('[sendSmartTransaction] Final Compute Units:', finalComputeUnits)
    } catch (err) {
      console.error('[sendSmartTransaction] Simulation failed:', err)
      throw err
    }
  }

  const latestBlockhashInfo = await connection.getLatestBlockhash({
    commitment: blockhashCommitment,
  })
  const finalTx = buildTransaction(
    finalComputeUnits!,
    latestBlockhashInfo.blockhash,
  )

  let txId: string
  let signedTx: VersionedTransaction
  try {
    console.log('[sendSmartTransaction] Signing transaction...')
    signedTx = await wallet.signTransaction(finalTx)
    console.log('[sendSmartTransaction] Signed transaction:', signedTx)
  } catch (err) {
    console.error('[sendSmartTransaction] SignTransaction Error:', err)
    const name = (err as any)?.name || ''
    const rawMsg = (err as any)?.message || ''
    let message = 'Wallet failed to sign'
    const lower = `${name} ${rawMsg}`.toLowerCase()
    if (lower.includes('not connected')) message = 'Wallet not connected'
    else if (lower.includes('reject')) message = 'User rejected the request'
    else if (
      name.includes('WalletSignTransactionError') ||
      rawMsg.includes('Unexpected error')
    ) {
      message = 'Wallet signer mismatch: wrong wallet connected'
    }
    const e = new Error(message)
    ;(e as any).originalError = err
    throw e
  }

  try {
    console.log('[sendSmartTransaction] Sending transaction...')
    txId = await connection.sendTransaction(signedTx, {
      skipPreflight: true,
      preflightCommitment: blockhashCommitment,
    })
    console.log('[sendSmartTransaction] Sent Tx ID:', txId)
  } catch (err) {
    const logs = getErrorLogs(err) ?? []
    if (logs.length) {
      console.error(
        '[sendSmartTransaction] SendTransaction Error Logs:',
        logs.join('\n'),
      )
    }
    console.error('[sendSmartTransaction] SendTransaction Error:', err)

    const message = parseErrorMessage(
      logs,
      (err as any)?.message || 'Transaction failed',
    )
    const e = new Error(message)
    ;(e as any).logs = logs
    ;(e as any).originalError = err
    throw e
  }

  if (confirmation) {
    try {
      console.log('[sendSmartTransaction] Confirming transaction...')
      const strategy: TransactionConfirmationStrategy = {
        blockhash: latestBlockhashInfo.blockhash,
        lastValidBlockHeight: latestBlockhashInfo.lastValidBlockHeight,
        signature: txId,
      }
      await connection.confirmTransaction(strategy, confirmation)
      console.log('[sendSmartTransaction] Transaction confirmed.')
    } catch (err) {
      console.error('[sendSmartTransaction] Confirmation Error:', err)
      throw err
    }
  }

  console.log('[sendSmartTransaction] Finished successfully. Tx ID:', txId)
  return txId
}
