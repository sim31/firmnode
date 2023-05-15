import { ethers } from 'ethers';
// TODO: fix path
import { FirmContractDeployer } from 'firmcontracts/interface/deployer';
import { Filesystem } from 'firmcontracts/typechain-types';

export default class FirmFs {
  protected _deployer: FirmContractDeployer;
  private _fsContract: Filesystem | undefined;

  // TODO:
  // * Save fs contract
  // * Subscribe to events from fs contract
  // * Take ipfs through constructor
  // * Create API (in firmnode) to import files / directories
  // * Write these files to IPFS

  constructor(provider: ethers.providers.JsonRpcProvider) {
    this._deployer = new FirmContractDeployer(provider);
  }

  async init() {
    await this._deployer.init();
    this._fsContract = await this._deployer.deployFilesystem();

    this._fsContract.on(
      this._fsContract.filters.SetRoot(),
      (addr, cid) => {
        console.log(`Updating root cid for ${addr}: ${cid}`);
      }
    )
  }
}
