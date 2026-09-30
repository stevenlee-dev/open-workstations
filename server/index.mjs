import { createApp } from './app.mjs';

const port = Number(process.env.PORT ?? 4312);
const host = process.env.HOST ?? '127.0.0.1';
const { app } = await createApp();
app.listen(port, host, () => console.log(`Open Workstations listening on ${host}:${port}`));
