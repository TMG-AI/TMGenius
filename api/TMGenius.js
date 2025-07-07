// api/tmgenius.js - Updated for TMGenius workflow
import Busboy from 'busboy';
import FormData from 'form-data';
import fetch from 'node-fetch';
import zlib from 'zlib';

export const config = {
  api: {
    bodyParser: false,
    maxDuration: 800, // Perfect for TMGenius 13+ minute processing
  },
};

export default async function handler(req, res) {
  console.log('🚀 TMGenius API called - Method:', req.method);
  
  // CORS headers for TMGenius
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  try {
    const busboy = Busboy({ 
      headers: req.headers,
      limits: { fileSize: 10 * 1024 * 1024, files: 5 }
    });
    
    let prompt = '';
    let phase = 'initial';
    const files = [];

    // Handle form fields and files
    busboy.on('field', (fieldname, value) => {
      if (fieldname === 'prompt') prompt = value;
      if (fieldname === 'phase') phase = value;
    });

    busboy.on('file', (fieldname, file, info) => {
      const chunks = [];
      file.on('data', chunk => chunks.push(chunk));
      file.on('end', () => {
        files.push({
          fieldname,
          filename: info.filename || `document-${Date.now()}.pdf`,
          buffer: Buffer.concat(chunks)
        });
      });
    });

    await new Promise((resolve, reject) => {
      busboy.on('finish', resolve);
      busboy.on('error', reject);
      setTimeout(() => reject(new Error('Upload timeout')), 30000);
    });

    if (!prompt) {
      return res.status(400).json({ error: 'Prompt is required' });
    }

    // Create FormData for TMGenius
    const formData = new FormData();
    formData.append('prompt', prompt);
    if (phase) formData.append('phase', phase);
    
    files.forEach(file => {
      formData.append('documents', file.buffer, {
        filename: file.filename,
        contentType: 'application/pdf'
      });
    });

    // Call your TMGenius webhook (update with your actual URL)
    const tmgeniusResponse = await fetch('https://YOUR-N8N-CLOUD-INSTANCE.app.n8n.cloud/webhook/8c7f9c77-c7a2-4316-ba2a-3b9ffefd4bf7', {
      method: 'POST',
      body: formData,
      headers: formData.getHeaders(),
      timeout: 800000
    });

    if (!tmgeniusResponse.ok) {
      const errorText = await tmgeniusResponse.text();
      return res.status(500).json({ error: 'TMGenius processing failed', details: errorText });
    }

    const responseText = await tmgeniusResponse.text();
    const responseData = JSON.parse(responseText);

    // Handle TMGenius clarification vs final response
    if (responseData.phase === 'clarification') {
      return res.status(200).json(responseData);
    } else {
      // Compress large responses
      const jsonString = JSON.stringify(responseData);
      const compressedData = zlib.gzipSync(jsonString);
      
      res.setHeader('Content-Encoding', 'gzip');
      res.setHeader('Content-Type', 'application/json');
      return res.send(compressedData);
    }

  } catch (error) {
    console.error('💥 TMGenius API error:', error.message);
    return res.status(500).json({ error: 'Internal server error', message: error.message });
  }
}
