import express, { type Express, type Request, type Response } from 'express';
import dotenv from 'dotenv';
import ganache from 'ganache';
import fs from 'fs';

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

const evmServer = ganache.server({
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

const evmPort = Number.parseInt(process.env.EVM_PORT ?? '60501');
evmServer.listen(evmPort, (err) => {
  if (err != null) {
    console.error('Error launching ganache: ', err);
  }
});

// TODO: routes
app.get('/', (req: Request, res: Response) => {
  res.send('Express + TypeScript Server!!!');
});

app.listen(mainPort, () => {
  console.log(`⚡️[server]: Server is running at http://localhost:${mainPort}`);
});
