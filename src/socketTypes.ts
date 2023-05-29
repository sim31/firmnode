import { ClientToServerEvents as FcClientToServer, ImportCallback } from 'firmcore/src/firmcore-firmnode/socketTypes.js';
import { AddressStr } from 'firmcore/node_modules/firmcontracts/interface/types.js';
import { Overwrite } from 'utility-types';

export * from 'firmcore/src/firmcore-firmnode/socketTypes.js';

export type ClientToServerEvents = Overwrite<FcClientToServer, {
  import: (
    to: AddressStr,
    carFile: Buffer[],
    callback: ImportCallback
  ) => void
}>;
