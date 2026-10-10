# JH Laboratoriox — site

Site estático (HTML, CSS e JavaScript puros), sem build. Publicado no GitHub Pages.

## Publicar

1. No GitHub, crie um repositório **público** chamado exatamente `laboratoriox.github.io`.
2. Envie todo o conteúdo desta pasta para a branch `main` (inclusive os arquivos que começam com ponto: `.nojekyll`).
3. Settings → Pages → Source: **Deploy from a branch** → `main` / `/ (root)` → Save.
4. Em **Custom domain**, digite `jhlaboratoriox.com.br` e salve. O arquivo `CNAME` já vem pronto.
5. Marque **Enforce HTTPS** quando o GitHub liberar.

Com isso, o Ateliê (repositório `atelie`) passa a abrir sozinho em
`https://jhlaboratoriox.com.br/atelie/`. Para isso, o repositório `atelie`
**não** pode ter domínio customizado próprio.

## DNS (Registro.br)

Quatro registros **A** com nome vazio e um **CNAME** para o `www`:

```
A      (vazio)   185.199.108.153
A      (vazio)   185.199.109.153
A      (vazio)   185.199.110.153
A      (vazio)   185.199.111.153
CNAME  www       laboratoriox.github.io.
```

## Cloudflare (API do Ateliê)

Em Settings → Variables, edite `ALLOWED_ORIGIN`:

```
https://laboratoriox.github.io,https://jhlaboratoriox.com.br,https://www.jhlaboratoriox.com.br
```

## Adicionar um módulo novo

Em `index.html`, dentro de `<ul class="lista">`, copie o bloco `<li>` do Ateliê e troque
o `href`, o nome e a descrição. Se o módulo for um repositório do GitHub Pages
(como `meu-app`), o endereço fica `jhlaboratoriox.com.br/meu-app/` e o `href` é `meu-app/`.

## Arquivos

- `index.html`, `styles.css`: página e visual (modo claro e escuro automáticos)
- `campo.js`: o campo de agulhas do topo (respeita "reduzir movimento")
- `404.html`, `favicon.svg`, `CNAME`, `.nojekyll`
