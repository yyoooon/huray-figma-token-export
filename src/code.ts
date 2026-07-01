import { extractFigma } from './extract';
import { transform } from './transform';

interface UIMessage {
  type: string;
  settings?: unknown;
}

figma.showUI(__html__, { width: 360, height: 560 });

figma.ui.onmessage = async (msg: UIMessage) => {
  if (msg.type === 'close') {
    figma.closePlugin();
    return;
  }
  if (msg.type === 'load-settings') {
    const settings = await figma.clientStorage.getAsync('settings');
    figma.ui.postMessage({ type: 'settings', settings: settings ?? {} });
    return;
  }
  if (msg.type === 'save-settings') {
    await figma.clientStorage.setAsync('settings', msg.settings);
    return;
  }
  if (msg.type === 'export') {
    const raw = await extractFigma();
    const tokens = transform(raw);
    figma.ui.postMessage({ type: 'result', tokens, raw });
  }
};
