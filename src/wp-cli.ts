import { execSync } from 'child_process';
import { basename } from 'path';

export function makePot(pluginPath: string, outputPath: string): void {
  execSync(`wp i18n make-pot "${pluginPath}" "${outputPath}"`, { stdio: 'inherit' });
}

export function updatePo(potFile: string, poFile: string): void {
  execSync(`wp i18n update-po "${potFile}" "${poFile}"`, { stdio: 'ignore' });
}

export function makeMo(languagesDir: string): void {
  execSync(`wp i18n make-mo "${languagesDir}"`, { stdio: 'inherit' });
}
