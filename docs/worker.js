import { analyze } from './src/backtest.js';
self.onmessage = ({ data }) => {
  try {
    const result = analyze(data.datasets, data.options, (progress, message) => self.postMessage({ type: 'progress', progress, message }));
    self.postMessage({ type: 'result', result });
  } catch (error) { self.postMessage({ type: 'error', error: error.message }); }
};
