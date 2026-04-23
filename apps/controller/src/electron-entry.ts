import { startControllerServer, type ControllerServerAddress } from "./index";
import { createLogger } from "./logger";

const logger = createLogger("controller", {
  component: "electron-entry"
});

const server = startControllerServer({
  onReady(address) {
    logger.info("controller.ready_notified", {
      address: address.address,
      port: address.port
    });
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
  logger.info("controller.shutdown_requested");
  server.close(() => {
    logger.info("controller.shutdown_complete");
    process.exit(0);
  });
}

process.once("SIGINT", shutdown);
process.once("SIGTERM", shutdown);
