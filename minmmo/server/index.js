import express from 'express';
import configRouter from './routes/config.js';
import gameConfigRouter from './routes/gameConfig.js';
import accountsRouter from './routes/accounts.js';
import charactersRouter from './routes/characters.js';
import merchantsRouter from './routes/merchants.js';
import { shutdownPool } from './db.js';
const app = express();
app.use(express.json());
app.get('/api/health', (_req, res) => {
    res.json({ status: 'ok' });
});
app.use('/api/config', gameConfigRouter);
app.use('/api/configs', configRouter);
app.use('/api/accounts', accountsRouter);
app.use('/api/characters', charactersRouter);
app.use('/api/merchants', merchantsRouter);
app.use((error, _req, res, _next) => {
    console.error(error);
    res.status(500).json({ message: 'Internal server error' });
});
const port = Number(process.env.PORT ?? 3001);
const server = app.listen(port, () => {
    console.log(`API listening on port ${port}`);
});
const signals = ['SIGTERM', 'SIGINT'];
signals.forEach(signal => {
    process.on(signal, () => {
        console.log(`Received ${signal}, shutting down gracefully...`);
        server.close(() => {
            shutdownPool()
                .then(() => process.exit(0))
                .catch(error => {
                console.error('Failed to shutdown pool cleanly', error);
                process.exit(1);
            });
        });
    });
});
export default app;
