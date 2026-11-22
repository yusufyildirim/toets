# {{ $params.name }}

{{ $params.description }}

## Pages

<ul v-if="$params.pages.length > 0">
  <li v-for="page in $params.pages" :key="page.link">
    <a :href="page.link">{{ page.title }}</a><span v-if="page.description">: {{ page.description }}</span>
  </li>
</ul>
<p v-else>No pages yet.</p>

## Offline copy

Installed packages ship these pages, version-matched, at <code>node_modules/{{ $params.name }}/docs/</code>.

## API

No generated API pages yet. The type declarations the package ships, <code>node_modules/{{ $params.name }}/dist/*.d.ts</code>, carry the TSDoc of every export.
