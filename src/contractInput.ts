import { AddressStr } from 'firmcontracts/interface/types'

export interface ContractInput {
  to: AddressStr
  gasLimit: number
  data: string
}

export interface FullTxInput {
  transaction: string
}
