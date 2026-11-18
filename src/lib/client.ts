import { OpenCode } from '@opencode/client';

export const client = OpenCode.make({
  baseUrl: `${window.location.origin}/oc`,
});

export const info = async (): Promise<{ directory: string }> => {
  const response = await fetch('/app/info');
  if (!response.ok) throw new Error('The app server is not answering.');
  return response.json();
};
