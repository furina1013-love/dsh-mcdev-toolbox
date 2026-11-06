import { runGradle } from '../build.js';

export async function runBuildTool(options) {
  return runGradle(options);
}
