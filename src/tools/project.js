import { detectProject, validateProject } from '../project.js';

export async function runProject(action, cwd) {
  const project = await detectProject(cwd);
  if (action === 'validate') {
    const validation = await validateProject(project);
    return { ...project, validation };
  }
  return project;
}
