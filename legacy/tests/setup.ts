import { startMockPythonServer, stopMockPythonServer } from './mocks/python-server';
import { startMockCodeIntelServer, stopMockCodeIntelServer } from './mocks/code-intel-server';

export async function setup() {
  await startMockPythonServer(18001);
  await startMockCodeIntelServer(18002);
}

export async function teardown() {
  await stopMockPythonServer();
  await stopMockCodeIntelServer();
}
