import { calculateSliceChunk } from './abbCrbSliceChunk.js';
self.onmessage = ({ data }) => {
  try { self.postMessage(calculateSliceChunk(data.slice, data.start, data.end)); }
  catch (error) { self.postMessage({ error: error.message || String(error) }); }
};
