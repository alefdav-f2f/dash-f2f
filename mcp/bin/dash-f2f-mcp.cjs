#!/usr/bin/env node
// Entrada do MCP. O build espelha a árvore do repo (o servidor importa
// src/lib do app), por isso o caminho tem o prefixo mcp/src.
require('../dist/mcp/src/server.js');
