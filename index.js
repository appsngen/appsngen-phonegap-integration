(function () {
    'use strict';

    var request = require('request');
    var fs = require('fs');
    var exec = require('child_process').exec;
    var path = require('path');
    var archiver = require('archiver');
    var _ = require('underscore');
    var WError = require('verror').WError;

    var BASE_URL = 'https://build.phonegap.com';
    var BASE_API_URL = BASE_URL + '/api/v1/';

    var writeIntegrationFile = function (options, callback) {
        var integrationScript;
        var originalTemplateSettings = _.templateSettings;
        var scriptTemplatePath = path.join(__dirname, '/templates/integration-template.txt');
        var packageScriptPath = path.join(options.projectPath, '/www/js/integration.js');
        var viewerEndpoint = options.serviceAddress + '/viewer';
        var widgetURL = options.serviceAddress + '/viewer/content/widgets/' + options.urn +
                        '/index.html?parent=file%3A%2F%2F&token=' + encodeURIComponent(options.token);
        var widgetName = options.urn.split(':').pop();

        _.templateSettings = {
            interpolate: /\{\{(.+?)\}\}/g
        };
        fs.readFile(scriptTemplatePath, 'utf8', function (error, template) {
            if (error) {
                callback(error);
                return;
            }

            integrationScript = _.template(template)({
                widgetURL: widgetURL,
                widgetUrn: options.urn,
                widgetName: widgetName,
                viewerEndpoint: viewerEndpoint
            });
            _.templateSettings = originalTemplateSettings;
            fs.writeFile(packageScriptPath, integrationScript, callback);
        });
    };

    exports.SUPPORTED_PLATFORMS = [
        'android',
        'ios'
    ];

    exports.getKeys = function (platform, accessToken, callback) {
        var url = BASE_API_URL + 'keys' + (platform ? '/' + platform : '') + '?access_token=' + accessToken;

        request.get(url, function (error, response) {
            var requestError;

            if (error) {
                callback(error);
                return;
            }

            switch (response.statusCode) {
                case 200:
                    callback(null, JSON.parse(response.body).keys);
                    break;
                case 401:
                    requestError = new WError('Invalid token.');
                    requestError.code = 401;
                    callback(requestError);
                    break;
                default:
                    requestError = new WError('Unexpected response from build.phonegap.com');
                    requestError.code = 500;
                    callback(requestError);
                    break;
            }
        });
    };

    exports.registerPhonegapApp = function (name, accessToken, packagePath, keys, callback) {
        var form, req;

        req = request.post(BASE_API_URL + 'apps?access_token=' + accessToken, function (error, response) {
            var body, requestError;

            if (error) {
                callback(error);
                return;
            }

            body = JSON.parse(response.body);
            switch (response.statusCode) {
                case 201:
                    callback(null, {
                        id: body.id,
                        title: body.title
                    });
                    break;
                case 400:
                    requestError = new WError(body.error);
                    requestError.code = 400;
                    callback(requestError);
                    break;
                case 401:
                    requestError = new WError('Invalid token.');
                    requestError.code = 401;
                    callback(requestError);
                    break;
                default:
                    requestError = new WError('Unexpected response from build.phonegap.com');
                    requestError.code = 500;
                    callback(requestError);
                    break;
            }
        });
        form = req.form();
        form.append('data', JSON.stringify({
            title: name,
            create_method: 'file',
            keys: keys
        }));
        form.append('file', fs.createReadStream(packagePath));
    };

    exports.createPhonegapPackage = function (projectPath, name, callback) {
        exec('npm run phonegap create "' + path.resolve(projectPath) + '" -- --name="' + name +
            '" --template="' + path.join(__dirname, 'templates/phonegap-template') + '"', {
            cwd: __dirname
        }, function (error, stdout, stderr) {
            callback(error, stdout, stderr);
        });
    };

    exports.generatePhonegapZipPackage = function (sourcePath, zipPath, callback) {
        var zipPackage = archiver.create('zip');
        var zipStream = fs.createWriteStream(zipPath);

        zipStream.on('close', function () {
            callback();
        });
        zipPackage.on('error', function (error) {
            callback(error);
        });
        zipPackage.pipe(zipStream);
        zipPackage.append(fs.createReadStream(path.join(sourcePath, 'config.xml')), {
            name: 'config.xml'
        });
        zipPackage.directory(path.join(sourcePath, 'www'), 'www');
        zipPackage.finalize();
    };

    // platform parametr can be one from SUPPORTED_PLATFORMS or 'all'
    exports.buildPhonegapApp = function (id, platform, accessToken, callback) {
        var url = BASE_API_URL + 'apps/' + id + '/build';

        if (platform !== 'all') {
            url += '/' + platform;
        }
        url += '?access_token=' + accessToken;

        request.post(url, function (error, response) {
            var requestError;

            if (error) {
                callback(error);
                return;
            }

            switch (response.statusCode) {
                case 202:
                    break;
                case 401:
                    requestError = new WError('Invalid token.');
                    requestError.code = 401;
                    break;
                case 404:
                    requestError = new WError('Application with id: %d. Doesn\'t exist.', id);
                    requestError.code = 404;
                    break;
                default:
                    requestError = new WError('Unable to start build. Unexpected response from build.phonegap.com');
                    requestError.code = 500;
                    break;
            }

            callback(requestError);
        });
    };

    exports.updatePhonegapApp = function (id, accessToken, packagePath, callback) {
        request.put(BASE_API_URL + 'apps/' + id + '?access_token=' + accessToken,
            function (error, response) {
                var body, responseError;

                if (error) {
                    callback(error);
                    return;
                }

                body = JSON.parse(response.body);
                switch (response.statusCode) {
                    case 200:
                        break;
                    case 401:
                        responseError = new WError('Invalid token.');
                        responseError.code = 401;
                        break;
                    case 404:
                        responseError = new WError('Application with id: %d. Doesn\'t exist.', id);
                        responseError.code = 404;
                        break;
                    default:
                        responseError = new WError('Unexpected response from build.phonegap.com');
                        responseError.code = 500;
                        break;
                }

                callback(responseError);
            })
            .form()
            .append('file', fs.createReadStream(packagePath));
    };

    exports.getDownloadLink = function (id, platform, accessToken, callback) {
        request.get({
            url: BASE_API_URL + 'apps/' + id + '/' + platform + '?access_token=' + accessToken,
            followRedirect: false
        }, function (error, response) {
            var requestError;

            if (error) {
                callback(error);
                return;
            }

            switch (response.statusCode) {
                case 302:
                    callback(null, JSON.parse(response.body).location);
                    break;
                case 401:
                    requestError = new WError('Invalid token.');
                    requestError.code = 401;
                    callback(requestError);
                    break;
                case 404:
                    requestError = new WError('Application with id: %d. Doesn\'t exist.', id);
                    requestError.code = 404;
                    callback(requestError);
                    break;
                default:
                    requestError = new WError('Unexpected response from build.phonegap.com');
                    requestError.code = 500;
                    callback(requestError);
                    break;
            }
        });
    };

    // options argument required fields:
    //      urn,
    //      identityToken,
    //      serviceAddress,
    //      projectPath
    // optional fields:
    //      port

    exports.setIntegration = function (options, callback) {
        var domains = [
            'file://'
        ];

        if (options.port) {
            domains.push('http://localhost:' + options.port);
        }
        request.post(
            options.serviceAddress + '/rest-services/tokens/access',
            {
                body: {
                    scope: {
                        widgets: [
                            options.urn
                        ]
                    },
                    domains: domains
                },
                json: true,
                headers: {
                    'Content-Type': 'application/json',
                    'Authorization': 'Bearer ' + options.identityToken
                }
            },
            function (error, response) {
                if (error) {
                    callback(error);
                    return;
                }

                options.token = response.body.accessToken;
                writeIntegrationFile(options, callback);
            }
        );
    };

    exports.isApplicationExists = function (id, accessToken, callback) {
        var url = BASE_API_URL + 'apps/' + id + '?access_token=' + accessToken;

        request.get(url, function (error, response) {
            var requestError;

            if (error) {
                callback(error);
                return;
            }

            switch (response.statusCode) {
                case 200:
                    callback(null, true);
                    break;
                case 401:
                    requestError = new WError('Invalid token.');
                    requestError.code = 401;
                    callback(requestError);
                    break;
                case 404:
                    callback(null, false);
                    break;
                default:
                    requestError = new WError('Unexpected response from build.phonegap.com');
                    requestError.code = 500;
                    callback(requestError);
                    break;
            }
        });
    };

    exports.getApplicationInformation = function (id, accessToken, callback) {
        var url = BASE_API_URL + 'apps/' + id + '?access_token=' + accessToken;

        request.get(url, function (error, response) {
            var requestError;

            if (error) {
                callback(error);
                return;
            }

            switch (response.statusCode) {
                case 200:
                    callback(null, JSON.parse(response.body));
                    break;
                case 401:
                    requestError = new WError('Invalid token.');
                    requestError.code = 401;
                    break;
                case 404:
                    requestError = new WError('Application with id: %d. Doesn\'t exist.', id);
                    requestError.code = 404;
                    callback(requestError);
                    break;
                default:
                    requestError = new WError('Unexpected response from build.phonegap.com');
                    requestError.code = 500;
                    callback(requestError);
                    break;
            }
        });
    };

    exports.unlockPhonegapSigningKey = function (keyLink, passwordObject, accessToken, callback) {
        var url = BASE_URL + keyLink + '?access_token=' + accessToken;

        request.put(url, function (error, response) {
            var requestError;

            if (error) {
                callback(error);
                return;
            }

            switch (response.statusCode) {
                case 202:
                    break;
                case 401:
                    requestError = new WError('Invalid token.');
                    requestError.code = 401;
                    break;
                case 404:
                    requestError = new WError('Key doesn\'t exist.');
                    requestError.code = 404;
                    break;
                default:
                    requestError = new WError('Unexpected response from build.phonegap.com');
                    requestError.code = 500;
                    break;
            }
            callback(requestError);
        })
        .form()
        .append('data', JSON.stringify(passwordObject));
    };
})();
