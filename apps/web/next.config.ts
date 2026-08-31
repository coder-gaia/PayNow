import type { NextConfig } from 'next';

const config: NextConfig = {
  reactStrictMode: true,
  // O painel nunca fala com o banco: todo dado vem da API do Paynow, pelo
  // servidor do Next, que é quem guarda os tokens em cookie httpOnly.
  env: {},
  typedRoutes: true,
};

export default config;
