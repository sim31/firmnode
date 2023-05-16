import { ethers } from 'ethers';
// TODO: fix path
import { FirmContractDeployer } from 'firmcontracts/interface/deployer';
import { Filesystem } from 'firmcontracts/typechain-types';
import { bytes32StrToCid0 } from 'firmcontracts/interface/cid';
import { create, IPFSHTTPClient } from 'ipfs-http-client';

export default class FirmFs {
  protected _deployer: FirmContractDeployer;
  protected _ipfsClient: IPFSHTTPClient;
  private _fsContract: Filesystem | undefined;

  constructor(provider: ethers.providers.JsonRpcProvider) {
    this._ipfsClient = create({
      url: 'http://127.0.0.1:5001/api/v0'
    });
    this._deployer = new FirmContractDeployer(provider);
  }

  async getEntry(address: string) {
    try {
      const stat = await this._ipfsClient.files.stat(`/.firm/${address}`);
      return stat;
    } catch (err) {
      console.log('Cant get entry: ', err);
      return undefined;
    }
  }

  async removeEntry(address: string) {
    try {
      await this._ipfsClient.files.rm(`/.firm/${address}`, { recursive: true });
    } catch (err: any) {
      console.error('Error deleting: ', typeof err === 'object' ? Object.entries(err) : err);
    }
  }

  async updateEntry(cid: string, address: string) {
    // * check if directory does not already exist
    // * If it does, check if it is the same as we are trying to set
    //   * If so - return
    //   * Otherwise delete it
    // * Copy CID

    console.log(`Updating root cid for ${address}: ${cid}`);

    const entry = await this.getEntry(address);
    if (entry !== undefined) {
      if (entry.cid.toV0().toString() === cid) {
        console.log('Entry already set');
        return;
      } else {
        await this.removeEntry(address);
      }
    }

    try {
      await this._ipfsClient.files.cp(
        '/ipfs/' + cid,
        `/.firm/${address}`,
        {
          parents: true,
          cidVersion: 0
        }
      );
    } catch (err: any) {
      // TODO: How to get more helpful message
      // eslint-disable-next-line @typescript-eslint/restrict-template-expressions
      console.error('cp command failed: ', typeof err === 'object' ? Object.entries(err) : err);
      throw err;
    }
  }

  async init() {
    await this._deployer.init();
    this._fsContract = await this._deployer.deployFilesystem();

    this._fsContract.on(
      this._fsContract.filters.SetRoot(),
      (addr, cidBytes) => {
        const cid: string = bytes32StrToCid0(cidBytes);
        void this.updateEntry(cid, addr);
      }
    )
  }
}
