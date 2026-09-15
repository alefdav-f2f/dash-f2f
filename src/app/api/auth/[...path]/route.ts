// Handler do Neon Auth: recebe as chamadas do client e as encaminha ao Neon.
import { auth } from '@/lib/auth';

export const { GET, POST } = auth.handler();
