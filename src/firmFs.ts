import { ethers } from 'ethers';
// TODO: fix path
import { FirmContractDeployer } from 'firmcore/node_modules/firmcontracts/interface/deployer';
import { Filesystem } from 'firmcore/node_modules/firmcontracts/typechain-types';
import { bytes32StrToCid0 } from 'firmcore/node_modules/firmcontracts/interface/cid';
import { create, IPFSHTTPClient } from 'ipfs-http-client';
import { normalizeHexStr } from 'firmcore/node_modules/firmcontracts/interface/abi';
import { AddressStr } from 'firmcore/node_modules/firmcontracts/interface/types';
import { ContractSeed } from 'firmcore/src/firmcore-firmnode/contractSeed';
import stringify from 'json-stable-stringify-without-jsonify'
import InvalidArgument from 'firmcore/src/exceptions/InvalidArgument';
import NotInitialized from 'firmcore/src/exceptions/NotInitialized';
import { CarCIDIterator } from '@ipld/car';
import { Message, CInputMsgCodec, MessageCodec, CInputEncMsg, CInputTxMsg, CInputDecMsg, newCInputTxMsg } from 'firmcore/src/firmcore-firmnode/message'
import NotImplementedError from 'firmcore/src/exceptions/NotImplementedError';
import { objectToFile, getFileCID } from 'firmcore/src/helpers/car';
import { PathReporter } from 'io-ts/PathReporter';
import { isLeft, isRight } from 'fp-ts/Either';
import { SendResult } from './socketTypes';
import { txApplied } from 'firmcore/src/helpers/transactions';

async function * buffersToAIterable(buffers: Buffer[]) {
  for (const buffer of buffers) {
    yield buffer;
  }
}

export default class FirmFs {
  protected _deployer: FirmContractDeployer;
  protected _ipfsClient: IPFSHTTPClient;
  protected _fsContract: Filesystem | undefined;
  protected _provider: ethers.providers.JsonRpcProvider;

  constructor(provider: ethers.providers.JsonRpcProvider) {
    this._provider = provider;
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
          // FIXME: should not be error here even without disabling
          // eslint-disable-next-line @typescript-eslint/restrict-plus-operands
          '/ipfs/' + seed.abiCID,
          `/.firm/${normAddr}/sc/abi.json`,
          {
            parents: true,
            cidVersion: 0
          }
        );
      }

      const encoder = new TextEncoder();

      const content = encoder.encode(stringify(seed.deploymentMsg, { space: 2 }));

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

  async importCARToAddr(addr: AddressStr, carFile: Buffer[]) {
    // * Check if this contract exists (we have its directory)
    // * Import this CAR file
    // * cp root of this CAR file
    const stat = this.getEntryStat(addr);
    if (stat === undefined) {
      throw new InvalidArgument('No directory for this address');
    }

    const cidIt = await CarCIDIterator.fromIterable(buffersToAIterable(carFile));
    const cids = await cidIt.getRoots();
    const cid = cids[0];
    if (cids.length > 1 || cid === undefined) {
      throw new InvalidArgument('Imported CAR file should have exactly one root');
    }

    const options = { pinRoots: false };

    for await (const v of this._ipfsClient.dag.import(carFile, options)) {
      console.log(v);
    }

    const cidStr = cid.toString();
    // eslint-disable-next-line @typescript-eslint/restrict-template-expressions
    const firmPath = `/.firm/${normalizeHexStr(addr)}/above/${cidStr}`
    await this._ipfsClient.files.cp(
      // eslint-disable-next-line @typescript-eslint/restrict-plus-operands
      '/ipfs/' + cidStr,
      firmPath,
      {
        parents: true,
        cidVersion: 0
      }
    );

    console.log('imported: ', cidStr, ' to: ', firmPath);

    return cids;
  }

  // Returns true if transaction succeded
  protected async _applyCInputEncMsg(
    inputMsg: CInputEncMsg
  ): Promise<ethers.providers.TransactionReceipt> {
    const resp = await this._provider.getSigner().sendTransaction({
      to: inputMsg.to,
      data: inputMsg.data
    });
    const receipt = await resp.wait();
    return receipt;
  }

  async sendMsgToContract(msg: Message): Promise<SendResult> {
    const fsContract = this.getFsContract();
    const stat = this.getEntryStat(msg.to);
    if (stat === undefined) {
      throw new InvalidArgument('No directory for this address');
    }

    const decoded = MessageCodec.decode(msg);
    // TODO: why does it complain here
    if (isLeft(decoded) === true) {
      const decoded = MessageCodec.decode(msg);
      if (isLeft(decoded) === true) {
        throw Error(
          // TODO: why does it complain here
          // eslint-disable-next-line @typescript-eslint/restrict-template-expressions
          `Could not validate: ${PathReporter.report(decoded).join('\n')}`
        );
      }
    }

    // TODO: move somewhere else
    // We now know it is a valid Message
    const file = objectToFile(msg);
    const cid = await getFileCID(file);
    if (cid === undefined) {
      throw new InvalidArgument('Unable to get CID of message');
    }
    const cidStr = cid.toString();
    const normTo = normalizeHexStr(msg.to);
    const firmPath = `/.firm/${normTo}/above/${cidStr}`
    await this._ipfsClient.files.write(
      firmPath,
      file.content,
      {
        offset: 0,
        create: true,
        parents: true,
        truncate: true
      }
    );

    const result: SendResult = { cidStr };

    const cdecoded = CInputMsgCodec.decode(msg);
    // eslint-disable-next-line @typescript-eslint/strict-boolean-expressions
    if (isRight(cdecoded)) {
      const m = cdecoded.right;
      switch (m.type) {
        case 'ContractInput': {
          result.error = 'Not implemented';
          break;
        }
        case 'ContractInputEncoded': {
          const receipt = await this._applyCInputEncMsg(m);
          result.txReceipt = receipt;
          if (txApplied(receipt) === true) {
            try {
              await this._ipfsClient.files.cp(
                firmPath,
                `/.firm/${normTo}/below/in/${cidStr}`,
                { parents: true }
              );

              // Handle messages to factory contract (we have to create directories for created smart contracts)
              if (m.to === this._deployer.getFactoryAddress()) {
                const address = this._deployer.getDetAddress(m.data);
                if (!await this._deployer.contractExists(address)) {
                  throw new Error('Transaction to factory succeeded but contract not created');
                }
                result.contractsCreated = [address];

                for (const log of receipt.logs) {
                  if (log.address === fsContract.address) {
                    const event = fsContract.interface.parseLog(log);
                    if (event.name === 'AbiSignal' && 'rootCID' in event.args) {
                      const cidBytes = event.args.rootCID;
                      if (typeof cidBytes === 'string') {
                        // Validate cidBytes
                        bytes32StrToCid0(cidBytes);
                        // Calculate contract address
                        try {
                          await this.initContractDir(address, {
                            abiCID: cidBytes,
                            deploymentMsg: m
                          });
                        } catch (err: any) {
                          result.error = `Failed creating directory for contract: ${JSON.stringify(err)}`;
                        }
                      } else {
                        result.error = 'Unexpected argument for AbiSignal event';
                      }
                    }
                  }
                }
              }
            } catch (err: any) {
              result.error = JSON.stringify(err);
            }
          } else {
            result.error = 'Applying tx failed'
          }
          break;
        }
        case 'ContractTxMsg': {
          result.error = 'Not implemented'
          break;
        }
        default: {
          // eslint-disable-next-line @typescript-eslint/no-unused-vars
          const exhaustiveCheck: never = m;
          break;
        }
      }
    }

    return result;
  }

  protected getFsContract(): Filesystem {
    if (this._fsContract === undefined) {
      throw new NotInitialized();
    }
    return this._fsContract;
  }

  async init() {
    await this._deployer.init();
    const deplTx = this._deployer.getFactoryDeploymentTx().transaction;
    await this.initContractDir(
      this._deployer.getFactoryAddress(),
      { deploymentMsg: newCInputTxMsg(this._deployer.getFactoryAddress(), deplTx) },
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
