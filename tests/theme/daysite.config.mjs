// Synthetic overrides exercise the public API; this fixture is not a published theme.
export default {
  apiVersion: 1,
  srcDir: './src',
  components: { Header: './src/Header.astro', Hero: './src/Hero.astro' },
  customCss: ['./src/theme.css'],
  publicDirs: ['./public'],
};
