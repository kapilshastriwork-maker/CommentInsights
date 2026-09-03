import 'dotenv/config';
import express, { Request, Response } from 'express';
import * as path from 'path';
import testIngestRouter from './routes/testIngest';
import testClassifyRouter from './routes/testClassify';
import testClusterRouter from './routes/testCluster';
import testDemandRouter from './routes/testDemand';
import testIntelligenceRouter from './routes/testIntelligence';
import searchCommentsRouter from './routes/searchComments';

const app = express();
const PORT = Number(process.env.PORT) || 4000;

app.use(express.json({ limit: '2mb' }));

app.get('/api/health', (_req: Request, res: Response) => {
  res.json({
    ok: true,
    service: 'comment-content-intelligence',
    time: new Date().toISOString(),
  });
});

app.use('/api/test-ingest', testIngestRouter);
app.use('/api/test-classify', testClassifyRouter);
app.use('/api/test-cluster', testClusterRouter);
app.use('/api/test-demand', testDemandRouter);
app.use('/api/test-intelligence', testIntelligenceRouter);
app.use('/api/search-comments', searchCommentsRouter);

if (process.env.NODE_ENV === 'production') {
  const clientDist = path.join(__dirname, '..', '..', 'client', 'dist');
  app.use(express.static(clientDist));

  app.all('/api/*', (_req: Request, res: Response) => {
    res.status(404).json({
      error: 'not_found',
      message: 'Unknown API route.',
    });
  });

  app.get('*', (_req: Request, res: Response) => {
    res.sendFile(path.join(clientDist, 'index.html'));
  });
}

app.listen(PORT, () => {
  // eslint-disable-next-line no-console
  console.log(`[server] listening on http://localhost:${PORT}`);
});
