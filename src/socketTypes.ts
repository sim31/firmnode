import { ClientToServerEvents as FcClientToServer, ErrorCallback } from 'firmcore/src/firmcore-firmnode/socketTypes';
import { AddressStr } from 'firmcore/node_modules/firmcontracts/interface/types';
import { Overwrite } from 'utility-types';

export * from 'firmcore/src/firmcore-firmnode/socketTypes';

export type ClientToServerEvents = Overwrite<FcClientToServer, {
  import: (
    to: AddressStr,
    carFile: Buffer[],
    callback: ErrorCallback
  ) => void
}>;
