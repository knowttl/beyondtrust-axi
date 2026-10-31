import net from "node:net";
import dgram from "node:dgram";
import { syncBuiltinESMExports } from "node:module";

const deny = (): never => { throw new Error("Network access is disabled during offline tests"); };
net.Socket.prototype.connect = deny;
dgram.Socket.prototype.send = deny;
globalThis.fetch = deny;
syncBuiltinESMExports();
