import { execFileSync } from 'node:child_process';
import { resolve } from 'node:path';
import { hostCli, hostRoot } from '../../shared/scripts/paths';

type Simulator = {
  name: string;
  udid: string;
  deviceTypeIdentifier?: string;
};
const inventory = JSON.parse(execFileSync('xcrun', [
  'simctl', 'list', 'devices', 'available', '--json',
], { encoding: 'utf8' })) as { devices: Record<string, Simulator[]> };

const target = process.env.APELL_SIMULATOR ?? 'Apell iPhone 16 Pro';
const matches = Object.values(inventory.devices).flat().filter((device) =>
  device.deviceTypeIdentifier?.startsWith('com.apple.CoreSimulator.SimDeviceType.iPhone-')
  && (device.udid.toLowerCase() === target.toLowerCase() || device.name === target));
if (matches.length !== 1) {
  throw new Error(`Expected one iPhone simulator matching "${target}". Set APELL_SIMULATOR to its name or UDID.`);
}

execFileSync(hostCli(), [
  'dev', '--project', hostRoot(), '--target', matches[0].udid,
  '--install', resolve('artifacts/recorder.apel'),
], { stdio: 'inherit' });
