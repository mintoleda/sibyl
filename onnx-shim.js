// Re-export onnxruntime-web instead of empty object
// This ensures env.backends.onnx.wasm exists even when transformers.js picks the node backend (true in Electron)
module.exports = require('onnxruntime-web');
