import { detectProject, validateProject } from '../project.js';
import { initProject } from '../scaffold.js';

export async function runProject(action, cwd, options = {}) {
  if (action === 'init') return initProject(options, cwd);
  const project = await detectProject(cwd);
  if (action === 'validate') {
    const validation = await validateProject(project);
    return { ...project, validation };
  }
  return project;
}
