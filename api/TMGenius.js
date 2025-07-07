// Updated TMGenius API route
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
  
  // Enhanced CORS headers for TMGenius
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, X-Session-ID');

  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }

  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  try {
    const busboy = Busboy({ 
      headers: req.headers,
      limits: {
        fileSize: 10 * 1024 * 1024, // 10MB limit
        files: 5, // Multiple document support
      }
    });
    
    let prompt = '';
    let phase = 'initial';
    let sessionId = '';
    let clarificationResponse = '';
    const files = [];

    // Handle text fields
    busboy.on('field', (fieldname, value) => {
      console.log(`📝 Field [${fieldname}]: ${value}`);
      
      switch(fieldname) {
        case 'prompt':
          prompt = value;
          break;
        case 'phase':
          phase = value;
          break;
        case 'sessionId':
          sessionId = value;
          break;
        case 'clarificationResponse':
          clarificationResponse = value;
          break;
      }
    });

    // Handle file uploads
    busboy.on('file', (fieldname, file, info) => {
      const { filename } = info;
      console.log('📄 File detected:', filename);
      
      const chunks = [];
      
      file.on('data', (chunk) => {
        chunks.push(chunk);
      });
      
      file.on('end', () => {
        const fileBuffer = Buffer.concat(chunks);
        files.push({
          fieldname,
          filename: filename || `document-${Date.now()}.pdf`,
          buffer: fileBuffer,
          size: fileBuffer.length
        });
        console.log('✅ File processed:', filename, fileBuffer.length, 'bytes');
      });
    });

    // Wait for upload completion
    await new Promise((resolve, reject) => {
      busboy.on('finish', resolve);
      busboy.on('error', reject);
      
      setTimeout(() => reject(new Error('Upload timeout')), 30000);
    });

    // Validate required data
    if (!prompt && !clarificationResponse) {
      return res.status(400).json({ 
        error: 'Either prompt or clarificationResponse is required' 
      });
    }

    console.log('📦 Creating TMGenius payload...');
    
    // Create FormData for TMGenius webhook
    const formData = new FormData();
    
    // Add text data
    if (prompt) formData.append('prompt', prompt);
    if (phase) formData.append('phase', phase);
    if (sessionId) formData.append('sessionId', sessionId);
    if (clarificationResponse) formData.append('clarificationResponse', clarificationResponse);

    // Add files
    files.forEach((file, index) => {
      formData.append(`documents`, file.buffer, {
        filename: file.filename,
        contentType: 'application/pdf'
      });
    });

    // Call TMGenius workflow with correct webhook URL
    const tmgeniusResponse = await fetch('https://YOUR-N8N-INSTANCE.app.n8n.cloud/webhook/8c7f9c77-c7a2-4316-ba2a-3b9ffefd4bf7', {
      method: 'POST',
      body: formData,
      headers: {
        ...formData.getHeaders(),
      },
      timeout: 800000, // 13+ minutes to match your workflow
    });

    console.log('📊 TMGenius response:', tmgeniusResponse.status);

    if (!tmgeniusResponse.ok) {
      const errorText = await tmgeniusResponse.text();
      console.error('❌ TMGenius failed:', errorText);
      return res.status(500).json({ 
        error: 'TMGenius processing failed', 
        details: errorText 
      });
    }

    const responseText = await tmgeniusResponse.text();
    let responseData;

    try {
      responseData = JSON.parse(responseText);
    } catch (parseError) {
      console.error('❌ JSON parse failed:', parseError.message);
      return res.status(500).json({ 
        error: 'Invalid response from TMGenius',
        rawResponse: responseText.substring(0, 1000)
      });
    }

    console.log('✅ TMGenius processing complete');
    
    // Handle TMGenius response types
    if (responseData.phase === 'clarification') {
      // Return clarification questions
      return res.status(200).json({
        phase: 'clarification',
        questions: responseData.questions,
        sessionId: sessionId || generateSessionId(),
        message: 'Please provide additional information'
      });
    } else {
      // Return final results
      const jsonString = JSON.stringify(responseData);
      const compressedData = zlib.gzipSync(jsonString);
      
      res.setHeader('Content-Encoding', 'gzip');
      res.setHeader('Content-Type', 'application/json');
      return res.send(compressedData);
    }

  } catch (error) {
    console.error('💥 TMGenius API error:', error.message);
    return res.status(500).json({ 
      error: 'Internal server error',
      message: error.message
    });
  }
}

function generateSessionId() {
  return Math.random().toString(36).substring(2, 15);
}
