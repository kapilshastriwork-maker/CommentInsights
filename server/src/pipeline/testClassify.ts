import 'dotenv/config';
import { DEFAULT_GROQ_MODEL } from '../groqClient';
import { classifyBatch } from './classifyComments';

const FIXTURE = [
  {
    id: 'fx1',
    text: 'How do I set this up on Windows? I keep getting an error on step 3.',
  },
  {
    id: 'fx2',
    text: 'Please make a part 2!!! This was fire 🔥',
  },
  {
    id: 'fx3',
    text: "Best explanation of transformers I've seen, thanks!",
  },
  {
    id: 'fx4',
    text: "I tried this and it doesn't work on M1 macs, are you sure about this?",
  },
  {
    id: 'fx5',
    text: "wait what does step 3 even mean, I'm so confused",
  },
];

async function main(): Promise<void> {
  console.log(`[testClassify] sending ${FIXTURE.length} comments to Groq…`);
  const t0 = Date.now();
  const result = await classifyBatch(FIXTURE);
  const ms = Date.now() - t0;
  console.log(
    `[testClassify] got ${result.length} result(s) in ${ms}ms (model=${DEFAULT_GROQ_MODEL})`,
  );
  console.log(JSON.stringify(result, null, 2));
}

main().catch((err) => {
  console.error('[testClassify] FAIL:', err);
  process.exit(1);
});
