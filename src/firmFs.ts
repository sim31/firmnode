import { ethers } from 'ethers';
// TODO: fix path
import { FirmContractDeployer } from 'firmcontracts/interface/deployer';
import { Filesystem } from 'firmcontracts/typechain-types';
import { bytes32StrToCid0 } from 'firmcontracts/interface/cid';
import { create, IPFSHTTPClient } from 'ipfs-http-client';
import { normalizeHexStr } from 'firmcontracts/interface/abi';
import { AddressStr } from 'firmcontracts/interface/types';
import { ContractSeed } from './contractSeed';
import stringify from 'json-stable-stringify-without-jsonify'

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

  async getEntryStat(address: string) {
    const normAddr = normalizeHexStr(address);
    try {
      const stat = await this._ipfsClient.files.stat(`/.firm/${normAddr}`);
      return stat;
    } catch (err) {
      console.log(`Cant get entry ${normAddr}:`, err);
      return undefined;
    }
  }

  async removeEntry(address: string) {
    const normAddr = normalizeHexStr(address);
    try {
      await this._ipfsClient.files.rm(`/.firm/${normAddr}`, { recursive: true });
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
    const normAddr = normalizeHexStr(address);

    console.log(`Updating root cid for ${normAddr}: ${cid}`);

    const entry = await this.getEntryStat(normAddr);
    if (entry !== undefined) {
      if (entry.cid.toV0().toString() === cid) {
        console.log('Entry already set');
        return;
      } else {
        await this.removeEntry(normAddr);
      }
    }

    try {
      await this._ipfsClient.files.cp(
        '/ipfs/' + cid,
        `/.firm/${normAddr}`,
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

  async createContractDir(
    address: AddressStr,
  ) {
    try {
      await this._ipfsClient.files.mkdir(
        `/.firm/${normalizeHexStr(address)}/above`,
        {
          parents: true,
          cidVersion: 0,
        }
      );
      await this._ipfsClient.files.mkdir(
        `/.firm/${normalizeHexStr(address)}/sc`,
        {
          cidVersion: 0,
        }
      )
      await this._ipfsClient.files.mkdir(
        `/.firm/${normalizeHexStr(address)}/below/in`,
        { parents: true, cidVersion: 0 }
      );
    } catch (err: any) {
      console.error(
        'Failed creating directory for contract: ', address,
        typeof err === 'object' ? Object.entries(err) : err
      );
    }
  }

  async initContractDir(address: AddressStr, seed: ContractSeed) {
    try {
      await this.createContractDir(this._deployer.getFactoryAddress());
      const normAddr = normalizeHexStr(address);

      if (seed.abiCID !== undefined) {
        await this._ipfsClient.files.cp(
          '/ipfs/' + seed.abiCID,
          `/.firm/${normAddr}/sc/abi.json`,
          {
            parents: true,
            cidVersion: 0
          }
        );
      }

      const encoder = new TextEncoder();

      const content = encoder.encode(stringify(seed.deploymentTx, { space: 2 }));

      // TODO: check if same CID is already there instead of writing each time?
      await this._ipfsClient.files.write(
        `/.firm/${normAddr}/sc/deployment.json`,
        content,
        {
          create: true,
          cidVersion: 0,
        }
      );
    } catch (err: any) {
      console.error(
        'Failed initializing contract dir: ',
        stringify(err),
      );
    }
  }

  async init() {
    await this._deployer.init();
    await this.initContractDir(
      this._deployer.getFactoryAddress(),
      { deploymentTx: this._deployer.getFactoryDeploymentTx() },
    );

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
