(function () {
    'use strict';

    var request = require('request');
    var fs = require('fs');
    var execSync = require('child_process').execSync;
    var path = require('path');
    var archiver = require('archiver');
    var _ = require('underscore');

    var BASE_URL = 'https://build.phonegap.com/api/v1/';

    var writeIntegrationFile = function (options, callback) {
        var getIntegrationScript;
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

            getIntegrationScript = _.template(template);
            fs.writeFile(packageScriptPath, getIntegrationScript({
                widgetURL: widgetURL,
                widgetUrn: options.urn,
                widgetName: widgetName,
                viewerEndpoint: viewerEndpoint
            }), callback);
        });
    };

    exports.SUPPORTED_PLATFORMS = [
        'android',
        'ios'
    ];

    exports.getKeys = function (accessToken, callback) {
        var url = BASE_URL + 'keys?access_token=' + accessToken;

        request.get(url, function (error, response) {
            if (error) {
                callback(error);
                return;
            }

            if (response.statusCode === 200) {
                callback(null, JSON.parse(response.body).keys);
            } else {
                callback(new Error('Unexpected response from build.phonegap.com.'));
            }
        });
    };

    exports.registerPhonegapApp = function (accessToken, packagePath, keys, callback) {
        var form, req;

        req = request.post(BASE_URL + 'apps?access_token=' + accessToken, function (error, response) {
            var body;

            if (error) {
                callback(error);
                return;
            }

            body = JSON.parse(response.body);
            if (response.statusCode === 201) {
                callback(null, {
                    id: body.id,
                    title: body.title
                });
            } else {
                callback(body.error);
            }
        });
        form = req.form();
        form.append('data', JSON.stringify({
            title: 'temp', // required field, PhoneGap Build replace it with title from config.xml
            create_method: 'file',
            keys: keys
        }));
        form.append('file', fs.createReadStream(packagePath));
    };

    exports.createPhonegapPackage = function (projectPath, name) {
        execSync('npm run phonegap create "' + path.resolve(projectPath) + '" -- --name="' + name +
            '" --template="' + path.join(__dirname, 'templates/phonegap-template') + '"', {
            stdio: 'inherit',
            cwd: __dirname
        });
    };

    exports.generatePhonegapZipPackage = function (sourcePath, zipStream) {
        var zipPackage = archiver.create('zip');

        zipPackage.on('error', function (error) {
            throw error;
        });
        zipPackage.pipe(zipStream);
        zipPackage.append(fs.createReadStream(path.join(sourcePath, 'config.xml')), {
            name: 'config.xml'
        });
        zipPackage.directory(path.join(sourcePath, 'www'), 'www');
        zipPackage.finalize();
    };

    // platform parametr can be one from SUPPORTED_PLATFORMS or 'all'
    exports.buildPhonegapApp = function (appId, platform, accessToken, callback) {
        var url = BASE_URL + 'apps/' + appId + '/build';

        if (platform !== 'all') {
            url += '/' + platform;
        }
        url += '?access_token=' + accessToken;

        request.post(url, function (error, response) {
            if (error) {
                callback(error);
                return;
            }

            if (response.statusCode === 202) {
                callback();
            } else {
                callback(new Error('Unable to start build. Unexpected response from build.phonegap.com.'));
            }
        });
    };

    exports.updatePhonegapApp = function (appId, accessToken, packagePath, callback) {
        request.put(BASE_URL + 'apps/' + appId + '?access_token=' + accessToken,
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
                        responseError = new Error('Invalid PhoneGap Id');
                        break;
                    case 404:
                        responseError = new Error(body.error);
                        break;
                    default:
                        responseError = new Error('Unexpected response from build.phonegap.com');
                        break;
                }
                callback(responseError);
            })
            .form()
            .append('file', fs.createReadStream(packagePath));
    };

    exports.getDownloadLink = function (appId, platform, accessToken, callback) {
        request.get({
            url: BASE_URL + 'apps/' + appId + '/' + platform + '?access_token=' + accessToken,
            followRedirect: false
        }, function (error, response) {
            var body;

            if (error) {
                callback(error);
                return;
            }

            body = JSON.parse(response.body);
            if (response.statusCode === 302) {
                callback(null, JSON.parse(response.body).location);
            } else {
                callback(new Error(body.error));
            }
        });
    };

    // options argument required fields
    // options = {
    //      urn,
    //      port,
    //      identityToken,
    //      serviceAddress,
    //      projectPath
    // };

    exports.setIntegration = function (options, callback) {
        request.post(
            options.serviceAddress + '/rest-services/tokens/access',
            {
                body: {
                    scope: {
                        widgets: [
                            options.urn
                        ]
                    },
                    domains: [
                        'file://',
                        'http://localhost:' + options.port
                    ]
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
})();
