const path = require('path');
const HtmlWebpackPlugin = require('html-webpack-plugin');

module.exports = (_env, argv) => {
  const production = argv.mode === 'production';

  return {
    entry: path.resolve(__dirname, 'editor.ts'),
    output: {
      path: path.resolve(__dirname, 'dist'),
      filename: production ? 'assets/[name].[contenthash:8].js' : 'assets/[name].js',
      clean: true,
    },
    devtool: production ? 'source-map' : 'eval-cheap-module-source-map',
    resolve: {
      extensions: ['.ts', '.js'],
    },
    module: {
      rules: [
        {
          test: /\.ts$/,
          exclude: /node_modules/,
          use: 'ts-loader',
        },
      ],
    },
    plugins: [
      new HtmlWebpackPlugin({
        template: path.resolve(__dirname, 'index.html'),
        scriptLoading: 'defer',
        minify: production,
      }),
    ],
    devServer: {
      static: false,
      hot: true,
      port: 8080,
      client: {
        overlay: true,
      },
    },
    performance: {
      hints: production ? 'warning' : false,
    },
  };
};
