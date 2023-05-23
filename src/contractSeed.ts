import { IPFSLink } from 'firmcontracts/interface/types'
import { ContractInput, FullTxInput } from './contractInput'

export interface ContractSeed {
  // TODO: better type
  abiCID?: IPFSLink
  deploymentTx: ContractInput | FullTxInput
}
