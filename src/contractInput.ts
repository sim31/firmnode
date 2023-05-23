import { AddressStr } from 'firmcore/node_modules/firmcontracts/interface/types'

export interface ContractInput {
  to: AddressStr
  gasLimit: number
  data: string
}

export interface FullTxInput {
  transaction: string
}
