import { buildSdkHeader } from '@prefactor/core';
import { PACKAGE_NAME, PACKAGE_VERSION } from './version.js';

export const AI_SDK_HEADER = buildSdkHeader(`${PACKAGE_NAME}@${PACKAGE_VERSION}`);
