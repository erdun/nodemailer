'use strict';

module.exports = function (grunt) {
    require('load-grunt-tasks')(grunt);
    // Project configuration.
    grunt.initConfig({
        eslint: {
            all: ['index.js', 'lib/**/*.js', 'test/**/*.js', 'examples/**/*.js', 'Gruntfile.js']
        },

        mochaTest: {
            all: {
                options: {
                    reporter: 'spec'
                },
                src: ['test/**/*-test.js']
            }
        },

        babel: {
            options: {
                sourceMap: false,
                presets: ['babel-preset-es2015'],
            },
            dist: {
                files: [{
                  'expand': true,
                  'cwd': 'lib/',
                  'src': ['*.js', '*/*.js'],
                  'dest': 'dist',
                  'ext': '.js'
                }]
            }
        },
    });

    // Load the plugin(s)
    grunt.loadNpmTasks('grunt-eslint');
    grunt.loadNpmTasks('grunt-mocha-test');

    // Tasks
    grunt.registerTask('default', ['eslint', 'mochaTest']);
};
