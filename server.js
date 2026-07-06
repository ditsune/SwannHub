const express = require('express');
const path = require('path');
const { processAccounts } = require('./login-worker');

const app = express();
app.use(express.json());
app.use(express.static('public'));

// Store results dan status
let processingStatus = {
    isProcessing: false,
    accounts: [],
    results: [],
    currentIndex: -1,
    total: 0
};

app.post('/api/process-accounts', async (req, res) => {
    const { accounts } = req.body;
    
    if (!accounts || !Array.isArray(accounts) || accounts.length === 0) {
        return res.status(400).json({ error: 'No accounts data provided' });
    }
    
    if (processingStatus.isProcessing) {
        return res.status(400).json({ error: 'Already processing accounts' });
    }
    
    // Reset status
    processingStatus = {
        isProcessing: true,
        accounts: accounts,
        results: [],
        currentIndex: 0,
        total: accounts.length
    };
    
    res.json({ 
        message: 'Processing started', 
        totalAccounts: accounts.length 
    });
    
    // Process di background
    try {
        const results = await processAccounts(accounts, (index, result) => {
            // Callback for real-time updates
            processingStatus.currentIndex = index + 1;
            processingStatus.results = [...processingStatus.results, result];
        });
        
        processingStatus.results = results;
        processingStatus.isProcessing = false;
        
    } catch (error) {
        console.error('Processing error:', error);
        processingStatus.isProcessing = false;
    }
});

// Get real-time status
app.get('/api/status', (req, res) => {
    res.json(processingStatus);
});

// Reset status
app.post('/api/reset', (req, res) => {
    processingStatus = {
        isProcessing: false,
        accounts: [],
        results: [],
        currentIndex: -1,
        total: 0
    };
    res.json({ message: 'Status reset' });
});

const PORT = 3000;
app.listen(PORT, () => {
    console.log(`Server running at http://localhost:3000`);
});