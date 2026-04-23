import { startControllerServer, type ControllerServerAddress } from "./index";

const server = startControllerServer({
  onReady(address) {
    notifyReady(address);
  }
});

let shuttingDown = false;

function notifyReady(address: ControllerServerAddress) {
  if (typeof process.send !== "function") {
    return;
  }

  process.send({
    type: "controller-ready",
    host: address.address,
    port: address.port
  });
}

function shutdown() {
  if (shuttingDown) {
    return;
  }

  shuttingDown = true;
  server.close(() => {
    process.exit(0);
  });
}

process.once("SIGINT", shutdown);
process.once("SIGTERM", shutdown);
