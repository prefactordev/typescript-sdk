import { PACKAGE_NAME, PACKAGE_VERSION } from './version.js';

type SdkPackage = {
  packageName: string;
  version: string;
};

export type RuntimeEnvironment = {
  prefactor_sdk: string[];
};

const CORE_SDK_PACKAGE: SdkPackage = {
  packageName: PACKAGE_NAME,
  version: PACKAGE_VERSION,
};

function formatSdkPackage(sdkPackage: SdkPackage): string {
  return `${sdkPackage.packageName}@${sdkPackage.version}`;
}

export function resolveRuntimeEnvironment(sdkPackages: SdkPackage[] = []): RuntimeEnvironment {
  const prefactorSdk = [...sdkPackages, CORE_SDK_PACKAGE].map((sdkPackage) =>
    formatSdkPackage(sdkPackage)
  );

  return {
    prefactor_sdk: Array.from(new Set(prefactorSdk)),
  };
}

export function formatRuntimeEnvironmentHeader(runtimeEnvironment: RuntimeEnvironment): string {
  return runtimeEnvironment.prefactor_sdk.join(' ');
}
