import { ethers } from 'ethers';
// TODO: fix path
import deployerPkg from 'firmcore/node_modules/firmcontracts/interface/deployer.js';
import { Filesystem } from 'firmcore/node_modules/firmcontracts/typechain-types';
import cidPkg from 'firmcore/node_modules/firmcontracts/interface/cid.js';
import { CID, create, IPFSHTTPClient } from 'kubo-rpc-client';
import abiPkg from 'firmcore/node_modules/firmcontracts/interface/abi.js';
import { AddressStr } from 'firmcore/node_modules/firmcontracts/interface/types.js';
import { ContractSeed } from 'firmcore/src/firmnode-base/contractSeed.js';
import stringify from 'json-stable-stringify-without-jsonify'
import { InvalidArgument } from 'firmcore/src/exceptions/InvalidArgument.js';
import { NotInitialized } from 'firmcore/src/exceptions/NotInitialized.js';
import { CarCIDIterator } from '@ipld/car';
import { Message, CInputMsgCodec, MessageCodec, CInputEncMsg, CInputTxMsg, CInputDecMsg, newCInputTxMsg, FactoryInputDecMsg } from 'firmcore/src/firmnode-base/message.js'
import { objectToFile, getFileCID, createCARFile, FsEntries } from 'firmcore/src/helpers/car.js';
import { PathReporter } from 'io-ts/lib/PathReporter.js';
import { isLeft, isRight } from 'fp-ts/lib/Either.js';
import { SendResult } from './socketTypes.js';
import { txApplied } from 'firmcore/src/helpers/transactions.js';
import { anyToStr } from './helpers/anyToStr.js';
import { FirmnodeBlockstore } from 'firmcore/src/firmnode-base/blockstore.js';
import { BaseFirmnode, EntryImportResult } from 'firmcore/src/firmnode-base/baseFirmnode.js';
import { UnixFSEntry, UnixFSFile, exporter } from "ipfs-unixfs-exporter";
import { NotFound } from 'firmcore/src/exceptions/NotFound.js';

class FirmContractDeployer extends deployerPkg.FirmContractDeployer {};
const { bytes32StrToCid0 } = cidPkg;
const { normalizeHexStr } = abiPkg;

async function * buffersToAIterable(buffers: Buffer[] | Uint8Array[]) {
  for (const buffer of buffers) {
    yield buffer;
  }
}

export class Firmnode extends BaseFirmnode {
  protected _deployer: FirmContractDeployer;
  protected _ipfsClient: IPFSHTTPClient;
  protected _fsContract: Filesystem | undefined;
  protected _provider: ethers.providers.JsonRpcProvider;
  protected _blockstore: FirmnodeBlockstore;

  constructor(provider: ethers.providers.JsonRpcProvider) {
    super();
    this._provider = provider;
    this._ipfsClient = create({
      url: 'http://127.0.0.1:5001/api/v0'
    });
    this._deployer = new FirmContractDeployer(provider);
    this._blockstore = new FirmnodeBlockstore(this);
  }

  async init() {
    await this._deployer.init();
    const deplTx = this._deployer.getFactoryDeploymentTx().transaction;
    try {
      await this.initContractDir(
        this._deployer.getFactoryAddress(),
        { deploymentMsg: newCInputTxMsg(this._deployer.getFactoryAddress(), deplTx) },
      );
    } catch (err: any) {
      console.log('Failed initializing factory dir: ', err);
    }

    this._fsContract = await this._deployer.deployFilesystem();

    this._fsContract.on(
      this._fsContract.filters.SetRoot(),
      (addr, cidBytes) => {
        const cid: string = bytes32StrToCid0(cidBytes);
        void this.updateEntry(cid, addr);
      }
    )
  }

  override async getIPBlockStat(cidStr: string) {
    const cid = CID.parse(cidStr);
    return await this._ipfsClient.block.stat(cid)
  }

  override async getIPBlock(cidStr: string) {
    const cid = CID.parse(cidStr);
    const block = await this._ipfsClient.block.get(cid);
    console.log('block: ', block);
    return block as Uint8Array;
  }

  override async getContractCID(address: AddressStr): Promise<string> {
    const stat = await this.getEntryStat(address);
    if (stat === undefined) {
      throw new Error(`Unable to retrieve stat for dir of contract: ${address}`)
    }
    return (stat.cid.toV0() as CID).toV0().toString();
  }

  override async readEntry(contractAddr: AddressStr, path: string): Promise<UnixFSEntry> {
    const cidStr = await this.getContractCID(contractAddr);
    const realPath = `${cidStr}/${path}`;
    return await exporter(realPath, this._blockstore);
  }

  override async importEntries(contractAddr: AddressStr, fsEntries: FsEntries): Promise<EntryImportResult[]> {

  }


  protected async getEntryStat(address: string) {
    const normAddr = normalizeHexStr(address);
    try {
      const stat = await this._ipfsClient.files.stat(`/.firm/${normAddr}`);
      return stat;
    } catch (err) {
      console.log(`Cant get entry ${normAddr}:`, err);
      return undefined;
    }
  }

  protected async removeEntry(address: string) {
    const normAddr = normalizeHexStr(address);
    try {
      await this._ipfsClient.files.rm(`/.firm/${normAddr}`, { recursive: true });
    } catch (err: any) {
      console.error('Error deleting: ', typeof err === 'object' ? Object.entries(err) : err);
    }
  }

  protected async getSubPathStat(address: string, subPath: string) {
    const normAddr = normalizeHexStr(address);
    const path = `/.firm/${normAddr}/${subPath}`
    const stat = await this._ipfsClient.files.stat(path);
    return stat;
  }

  protected async getSubPathCID(address: string, subPath: string) {
    const stat = await this.getSubPathStat(address, subPath);
    return stat.cid.toV0() as CID;
  }

  protected async getSubPathCIDStr(address: string, subPath: string) {
    return (await this.getSubPathCID(address, subPath)).toString();
  }

  protected async updateEntry(cid: string, address: string) {
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

  protected async createContractDir(
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

  protected async initContractDir(address: AddressStr, seed: ContractSeed) {
    const normAddr = normalizeHexStr(address);
    await this.createContractDir(normAddr);

    if (seed.abiCID !== undefined) {
      await this._ipfsClient.files.cp(
        // FIXME: should not be error here even without disabling
        // eslint-disable-next-line @typescript-eslint/restrict-plus-operands
        `/ipfs/${seed.abiCID}`,
        `/.firm/${normAddr}/sc/abi.json`,
        {
          parents: true,
          cidVersion: 0
        }
      );
    }


    if (typeof seed.deploymentMsg === 'string') {
      // Then it is simply a cidv0
      await this._ipfsClient.files.cp(
        // FIXME: should not be error here even without disabling
        // eslint-disable-next-line @typescript-eslint/restrict-plus-operands
        `/ipfs/${seed.deploymentMsg}`,
        `/.firm/${normAddr}/sc/deployment.json`,
        { cidVersion: 0 }
      );

    } else {
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
    }
  }

  protected async _pathExists(firmPath: string, cid: CID): Promise<boolean> {
    const cidStr = cid.toV0().toString();
    try {
      const stat = await this._ipfsClient.files.stat(firmPath);
      if (typeof stat.cid.toString === 'function') {
        if (stat.cid.toString() === cidStr) {
          return true;
        } else {
          throw new Error(`Entry with the name of ${cidStr} exists but it has a different cid.`)
        }
      } else {
        throw new Error('Response from file.stat does not contain expected cid field');
      }
    } catch (err: any) {
      return false;
    }
  }

  protected async importCARToAddr(addr: AddressStr, carFile: Buffer[] | Uint8Array[], extension?: string) {
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

    const cidStr = cid.toV0().toString();

    const filename = extension ? `${cidStr}.${extension}` : `${cidStr}`;
    const firmPath = `/.firm/${normalizeHexStr(addr)}/above/${filename}`

    if (await this._pathExists(firmPath, cid)) {
      console.log('import: ', cidStr, ' already exists');
      return { cid, path: firmPath };
    }

    // eslint-disable-next-line @typescript-eslint/restrict-template-expressions
    // First check if directory already exists and it has the same CID
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

    return { cid, path: firmPath }
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

  protected async _applyFactoryInputDec(
    inputMsg: FactoryInputDecMsg
  ): Promise<ethers.providers.TransactionReceipt> {
    const abiCIDStr = inputMsg.abiCIDStr;

  }

  protected async _importMsg(msg: Message) {
    const { parts, rootCID, } = await createCARFile(
      [objectToFile(msg)], { wrapInDir: false }
    );
    const { path } = await this.importCARToAddr(msg.to, parts, 'json')
    return { cid: rootCID, path };
  }

  protected async sendMsgToContract(msg: Message): Promise<SendResult> {
    const fsContract = this.getFsContract();
    const stat = this.getEntryStat(msg.to);
    if (stat === undefined) {
      throw new InvalidArgument('No directory for this address');
    }

    const decoded = MessageCodec.decode(msg);
    if (isLeft(decoded)) {
      throw Error(
        `Could not validate: ${PathReporter.report(decoded).join('\n')}`
      );
    }

    // We now know it is a valid Message
    const { path: abovePath, cid } = await this._importMsg(msg);

    const cidStr = cid.toString();
    const normTo = normalizeHexStr(msg.to);

    const belowCIDStr = await this.getSubPathCIDStr(normTo, 'below');

    const result: SendResult = { cidStr, belowCIDStr };

    const cdecoded = CInputMsgCodec.decode(msg);
    // eslint-disable-next-line @typescript-eslint/strict-boolean-expressions
    if (isRight(cdecoded)) {
      const m = cdecoded.right;
      switch (m.type) {
        case 'FactoryInputDec': {
          result.error = 'Not implemented';
          break;
        }
        case 'ContractInputDec': {
          result.error = 'Not implemented';
          break;
        }
        case 'ContractInputEnc': {
          const receipt = await this._applyCInputEncMsg(m);
          result.txReceipt = receipt;
          if (txApplied(receipt)) {
            try {
              await this._ipfsClient.files.cp(
                abovePath,
                `/.firm/${normTo}/below/in/${cidStr}.json`,
                { parents: true, cidVersion: 0 }
              );

              result.belowCIDStr = await this.getSubPathCIDStr(normTo, 'below');

              // Handle messages to factory contract (we have to create directories for created smart contracts)
              if (m.to === this._deployer.getFactoryAddress()) {
                const address = this._deployer.getDetAddress(m.data);
                if (!await this._deployer.contractExists(address)) {
                  throw new Error('Transaction to factory succeeded but contract not created');
                }
                result.contractsCreated = [
                  { address, belowCIDStr: null }
                ];

                let initialized: boolean = false;
                const parsedLogs = [];
                for (const log of receipt.logs) {
                  console.log("log: ", log);
                  console.log('fsContract.address: ', fsContract.address);
                  const addr = normalizeHexStr(log.address);
                  if (addr === normalizeHexStr(fsContract.address)) {
                    const event = fsContract.interface.parseLog(log);
                    parsedLogs.push(event);
                    if (event.name === 'AbiSignal' && 'rootCID' in event.args) {
                      const cidBytes = event.args.rootCID;
                      if (typeof cidBytes === 'string') {
                        // Validate cidBytes
                        const abiCID = bytes32StrToCid0(cidBytes);
                        // Calculate contract address
                        try {
                          await this.initContractDir(address, {
                            abiCID: abiCID,
                            deploymentMsg: cid.toV0().toString(),
                          });
                          result.contractsCreated[0]!.belowCIDStr = 
                            await this.getSubPathCIDStr(address, 'below');
                          initialized = true;
                        } catch (err: any) {
                          result.error = `Failed creating directory for contract: ${anyToStr(err)}`;
                        }
                      } else {
                        result.error = 'Unexpected argument for AbiSignal event';
                      }
                    }
                  }
                }
                
                if (!initialized && result.error === undefined) {
                  result.error = 'abi signal event not found in the logs. Logs: ' + parsedLogs.toString();
                }
              }
            } catch (err: any) {
              result.error = anyToStr(err);
            }
          } else {
            result.error = 'Applying tx failed'
          }
          break;
        }
        case 'ContractInputTx': {
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

}
