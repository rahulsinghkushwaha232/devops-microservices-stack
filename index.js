const app = require('./app/index.js');

if (require.main === module) {
  const port = Number(process.env.PORT || 3000);
  app.listen(port, () => console.log(`Server listening on port ${port}`));
}

module.exports = app;
