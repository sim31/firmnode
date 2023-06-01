import type { Express, Request, Response } from 'express';
import express from 'express';
import { createServer } from 'http';
import { Server } from 'socket.io';
import dotenv from 'dotenv';
import ganache from 'ganache';
import { ethers } from 'ethers';
import * as fs from 'fs';
import FirmFs from './src/firmnode.js';
import { ServerToClientEvents, ClientToServerEvents } from './src/socketTypes.js';
import { anyToStr } from './src/helpers/anyToStr.js';
import { left, right } from 'fp-ts/lib/Either.js';

const dbDir = './.db';
const accountsPath = './.db/accounts.json';

if (!fs.existsSync(dbDir)) {
  fs.mkdirSync(dbDir);
}

let privateKey: string | undefined;
if (fs.existsSync(accountsPath)) {
  const accJson = fs.readFileSync(accountsPath, { encoding: 'utf-8' });
  const accObj = JSON.parse(accJson);
  const keys = Object.values(accObj.private_keys);
  if (typeof keys[0] === 'string') {
    privateKey = keys[0];
    console.log('Retrieved key');
  }
}

dotenv.config();
const mainPort = process.env.MAIN_PORT ?? '60500';
const gatewayPort = process.env.GATEWAY_PORT ?? '60502';

const app: Express = express();
const server = createServer(app);
const io = new Server<ClientToServerEvents, ServerToClientEvents>(server, {
  cors: {
    origin: 'http://localhost:5173'
  }
});

// TODO: Launch kubo
// TODO: Launch ganche

const walletConfig = privateKey !== undefined
  ? {
      accounts: [{
        balance: 100000000000000000000,
        secretKey: privateKey
      }],
    }
  : {
      totalAccounts: 1,
      defaultBalance: 100000000000000000000,
      accountKeysPath: accountsPath,
    };

const ganacheServer = ganache.server({
  chain: {
    vmErrorsOnRPCResponse: true
  },
  database: {
    dbPath: './.db',
  },
  logging: {
    verbose: true
  },
  wallet: walletConfig,
  miner: {
    defaultTransactionGasLimit: 'estimate'
  }
});

let firmFs: FirmFs | undefined;

const evmPort = Number.parseInt(process.env.EVM_PORT ?? '60501');
const evmAddress = `http://localhost:${evmPort}`;
ganacheServer.listen(evmPort, (err) => {
  if (err != null) {
    console.error('Error launching ganache: ', err);
  } else {
    // FIXME: This doesn't work
    console.log('Ethereum JSON RPC: ', evmAddress)

    const provider = new ethers.providers.JsonRpcProvider(evmAddress);
    firmFs = new FirmFs(provider);
    void firmFs.init();
  }
});

// TODO: routes
// eslint-disable-next-line @typescript-eslint/no-misused-promises
app.get('/proc/:addr', async (req: Request, res: Response) => {
  const { addr } = req.params;
  if (addr === undefined) {
    throw Error('Undefined request parameter');
  }
  if (firmFs === undefined) {
    throw Error('Not ready');
  }

  const entry = await firmFs.getEntryStat(addr);

  if (entry === undefined) {
    res.sendStatus(404);
  } else {
    res.send(entry);
  }
});

io.on('connection', (socket) => {
  console.log('A socket connection ', socket.id);
  socket.on('import', async (to, carFile, callback) => {
    if (firmFs === undefined) {
      // eslint-disable-next-line n/no-callback-literal
      callback('not initialized');
      return;
    }
    try {
      console.log('import from: ', socket.id, '. carFile: ', carFile);
      const results = await firmFs.importCARToAddr(to, carFile);
      // eslint-disable-next-line n/no-callback-literal
      callback({ roots: [results.cid] });
      console.log('results: ', results);
    } catch (err: any) {
      console.error('Error importing: ', err);
      callback(anyToStr(err));
    }
  });

  socket.on('send', async (msg, callback) => {
    if (firmFs === undefined) {
      // eslint-disable-next-line n/no-callback-literal
      callback({ error: 'not initialized' });
      return;
    }

    try {
      const result = await firmFs.sendMsgToContract(msg);
      if (result.error !== undefined) {
        console.log('error: ', result.error);
      }
      callback(result);
    } catch (err: any) {
      console.log('Error sending: ', err);
      // eslint-disable-next-line n/no-callback-literal
      callback({ error: anyToStr(err) })
    }
  });

  socket.on('getPathCID', async (address, path, callback) => {
    if (firmFs === undefined) {
      callback(left('not initialized'));
      return;
    }

    try {
      const cidStr = await firmFs.getSubPathCIDStr(address, path);
      callback(right(cidStr));
    } catch (err: any) {
      console.log('Error trying to respond to getPathCID request, ', address, '/', path, err);
      callback(left(anyToStr(err)));
    }
  });

  socket.on('getIPBlockStat', async (cidStr, callback) => {
    if (firmFs === undefined) {
      callback(left('not initialized'));
      return;
    }

    try {
      const stat = await firmFs.getIPBlockStat(cidStr);
      callback(right(stat));
    } catch (err: any) {
      console.log('Error trying to respond to getIPBlockStat request, ', cidStr, ', ', err);
      callback(left(anyToStr(err)));
    }
  });

  socket.on('getIPBlock', async (cidStr, callback) => {
    if (firmFs === undefined) {
      callback(left('not initialized'));
      return;
    }

    try {
      const block = await firmFs.getIPBlock(cidStr);
      callback(right(block));
    } catch (err: any) {
      console.log('Error trying to respond to getIPBlockStat request, ', cidStr, ', ', err);
      callback(left(anyToStr(err)));
    }
  });
});

server.listen(mainPort, () => {
  console.log(`⚡️[server]: Server is running at http://localhost:${mainPort}`);
});
