import { ethers } from 'ethers';
// TODO: fix path
import { FirmContractDeployer } from 'firmcontracts/interface/deployer';

export default class FirmFs {
  protected _deployer: FirmContractDeployer;

  constructor(provider: ethers.providers.JsonRpcProvider) {
    this._deployer = new FirmContractDeployer(provider);
  }

  async init() {
    await this._deployer.init();
    await this._deployer.deployFilesystem();
  }
}
