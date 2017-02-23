var mailer = require('../mailer/mailer.js');
var currencyFormat = require('currency-formatter');
var moment = require('moment');
var fs = require('fs');
var config = process.env;

/* ZIMBRA FUNCTIONS */

var ZimbraAdminApi = require('zimbra-admin-api-js');

function initZimbra() {
	var promise = new Parse.Promise();
	var zimbraApi = new ZimbraAdminApi({
	  'url': config.ZIMBRA_ENDPOINT,
	  'user': config.ZIMBRA_USER,
	  'password': config.ZIMBRA_PWD
	});

	zimbraApi.login((error, success) => {
		if (error) {
			return promise.reject(error);
		}

		return promise.resolve(zimbraApi);
	});

	return promise;
}

/* ZIMBRA FUNCTIONS */

/**************************************************************************************************************/

/* HELPER FUNCTIONS */

function getTotalSales(items, currency) {
	var salesString = '';
	var total = 0;

	var keys = typeof items === 'object' && items.constructor.name === 'Object' ? Object.keys(items) : null;

	keys.forEach(function(plan){
		if (items[plan].total > 0) {
			total += items[plan].total;
		}
	});

	var precision = currency === 'CLP' ? 0 : 2;
    var currencyParams = {code: currency, precision};
    total = currencyFormat.format(total, currencyParams) + ' ' + currency;

	return total;
}

function replaceVarsInFile(fileAsString, varsAsObject){
	var keys = Object.keys(varsAsObject);
	var file = typeof fileAsString === 'string' ? fileAsString : fileAsString.toString();
	var newFileAsString = file;

	keys.forEach(function(key){
		var hook = '{$' + key + '}';
		newFileAsString = newFileAsString.replace(hook, varsAsObject[key]);
	});

	return newFileAsString;
}

function getDaysFromDate2Date(dateFrom, dateTo) {
    // check if it receive and real object date or just string
    var from = typeof dateFrom === 'object' ? dateFrom : new Date(dateFrom);
    var to = typeof dateTo === 'object' ? dateTo : new Date(dateTo);
    // get timestamp of each date and then subtract them. just get the absolute result
    var timeDiff = Math.abs(from.getTime() - to.getTime());
    // round to up the result, and divide result of subtract with the amount of milliseconds of one day.
    var diffDays = Math.ceil(timeDiff / (1000 * 3600 * 24));
    return diffDays;
}

function getNextPaymentDate(createAt) {
    var from = typeof createAt === 'object' ? createAt : new Date(createAt);
    var now = new Date();
    var currentYear = now.getFullYear();
    var timeDiff = Math.abs(from.getTime() - now.getTime());
    var addBisiest = ((currentYear % 4 === 0) && (currentYear % 100 !== 0) || (currentYear % 400 === 0)) ? 1 : 0;
    var diffDays = Math.ceil(timeDiff / (1000 * 3600 * 24));
    var newCreateAt = new Date(from.setYear(from.getFullYear() + 1));

    if (diffDays > (365 + addBisiest)) {
    	return getNextPaymentDate(newCreateAt);
    }

    return newCreateAt;
}

function checkAccount(cta, domainId) {
	var acc = cta || false;
	var domId = domainId || false;

	if (domId && acc) {
		var zimbra = initZimbra();
		return new Promise(function(resolve, reject){
			return zimbra.then(function(zimbraAPI){
				return zimbraAPI.getAccount(acc, function(err, account){
					if (err) {
						return reject(err);
					}

					//var isAdmin = account.attrs.zimbraIsAdminAccount === 'TRUE';
					var isAdmin = account.attrs.zimbraIsDelegatedAdminAccount === "TRUE";

					if (isAdmin) {
						var domainFromAccount = account.domain;
						return zimbraAPI.getDomain(domId, function(err, domain){
							if (err) {
								return reject(err);
							}

							return resolve({domain, account});
						});
					}

					return reject({code: 401, message: acc + ' is not authorizathed.'});
				});
			}).catch(function(error){
				return reject(error);
			});
		});
	}

	return false;
}

function updatePlans(domainId, attrs) {
	var domId = domainId || '';
	var attributes = attrs || false;

	if (domId && attributes) {
		var zimbra = initZimbra();
		return new Promise(function(resolve, reject){
			return zimbra.then(function(zimbraAPI){
				return zimbraAPI.modifyDomain(domId, attributes, function(err, updated){
					if (err) {
						return reject(err);
					}

					return resolve(updated);
				});
			}).catch(function(error){
				return reject(error);
			});
		});
	}
}

function clearCacheZimbra(domainName) {
	if (domainName && domainName.trim().length > 0) {
		var zimbra = initZimbra();
		return new Promise(function(resolve, reject){
			return zimbra.then(function(zimbraAPI){
				return zimbraAPI.flushCache({type: 'domain', allServers: 1, entry: domainName}, function(err, cleared){
					if (err) {
						return reject(err);
					}

					return resolve(cleared);
				});
			}).catch(function(){
				return reject(error);
			});
		});
	}
}

function sendEmail(template, vars, attrs) {
	var emailToNotify = config.EmailAPI_NOTIFICATIONS_SUCCESS;
	var attrs = attrs || {};

	var mailOptions = {
	    from: '"Manager ZBox Ventas \u2705" <noreplay@zboxapp.com>',
	    to: emailToNotify,
	    subject: 'Una compra fue hecha desde Manager Zboxapp'
	};

	var options = Object.assign(mailOptions, attrs);

	return new Promise(function(resolve, reject){
		fs.readFile(__dirname + '/../template_email/' + template, function (err, data) {
			if (err) {
				return reject(err);
			}

			var fileHTML = replaceVarsInFile(data, vars);

			options.html = fileHTML;

			// send mail with defined transport object
			
			mailer.sendMail(options, function(error, info){
			    if(error){
			    	return reject(error);
			    }
			    return resolve(info);
			});
		});
	});
}

/* HELPER FUNCTIONS */

/**************************************************************************************************************/

/* CLOUD FUNCTIONS PARSE */

Parse.Cloud.define('getPrices', function(req, res){
	return res.error({ok: true});
	var now = new Date();
	var domainId = req.params.domainId;
	var domainCreateAt = req.params.domainCreatedDate;
	var isAnual;
	var currency = req.params.currency;
	var type = req.params.type || 'standar';

	if (!type || !currency || !domainId) {
		return res.error({code: 404, message: 'missing some attributes to get prices'});
	}

	currency = currency.toUpperCase();

	var query = new Parse.Query("domains");

	query.equalTo('domainId', domainId);

	query.find({
		success: function(domain){
			if (domain.length > 0 && domain.length === 1) {
				isAnual = domain[0].get('isAnual');
				domainCreateAt = domainCreateAt || moment(domain[0].get('zimbraCreateTimestamp')).format('MM/DD/Y');
				var queryPrices = new Parse.Query("prices");

				queryPrices.equalTo('type', type);

				queryPrices.find({
					success: function(results) {
						if (results.length > 0 && results.length === 1) {
							var prices = results[0].get('prices');
							var wrongCurrency = false;
							var priceCalculated = {};
							var pricesKeys = Object.keys(prices);

							if (isAnual) {
								var description = 'Los valores están pro-rateados para hacerlos coincidir con la próxima fecha de facturación de su plan mensual, que será el próximo ';
								var dateTo = getNextPaymentDate(domainCreateAt);
								description += moment(dateTo).format('DD/MM/Y');
								var diffDays = getDaysFromDate2Date(now, dateTo);

								pricesKeys.forEach(function(plan){
									wrongCurrency = !prices[plan][currency];
									if (!wrongCurrency) {
										var newPrice = (prices[plan][currency].anual / 365) * diffDays;
								 		priceCalculated[plan] = Math.round(newPrice);
									}
								});

								prices = priceCalculated;
							} else {
								pricesKeys.forEach(function(plan){
									wrongCurrency = !prices[plan][currency];
									if (!wrongCurrency) {
								 		priceCalculated[plan] = prices[plan][currency].month;
									}
								});

								prices = priceCalculated;
							}

							if (wrongCurrency) {
								return res.error({code: 400, message:'provide currency "' +currency+ '"doesn\'t exists'});
							}

							return res.success({prices, isAnual, description});
						}

						return res.error({code: 404, message: 'not found, type ' + type + ' of prices'});
					},

					error: function (err){
						return res.error(err);
					}
				});
			} else {
				return res.error({code: 404, message: 'not found, any domain to get its prices'});
			}
		},
		error: function(err){
			return res.error(err);
		}
	});
});

Parse.Cloud.afterSave('sales', function(req){
	// get the items to get the total price.
	if(req.object.existed() === true) {
		return false;
	}

	var id = req.object.id;
	var items = req.object.get('items');
	var itemsKeys = Object.keys(items);
	var actionCreator = req.object.get('adminEmail');
	var domainName = req.object.get('domainName');
	var companyId = req.object.get('companyId');
	var currency = req.object.get('currency');
	var period = req.object.get('period');
	var fullname = req.object.get('fullname');
	var mailboxes = req.object.get('items');
	var precision = currency === 'CLP' ? 0 : 2;
    var currencyParams = {code: currency, precision};
	var total = 0;
	var sale = '';

	itemsKeys.forEach(function(key){
		total += items[key].total || items[key].price;
		var size = items[key].quantity;
		var isPlural = size > 1 ? 'casillas' : 'casilla';
		sale += size + ' ' + isPlural + ' ' + key + ', ';
	});

	sale = sale.substring(0, sale.length - 2);

	total = currencyFormat.format(total, currencyParams) + ' '+ currency;

	Parse.Cloud.run('generateInvoice', {
		saleString: sale,
		total,
		id,
		companyId,
		mailboxes,
		currency,
		domainName,
		period,
		fullname
	}).then(function(result){
		res.success(result);
	}).catch(function(error){
		res.error(error);
	});
});

Parse.Cloud.define('generateInvoice', function(req, res){
	var id = req.params.id;
	var total = req.params.total;
	var saleString = req.params.saleString;
	var companyId = req.params.companyId;
	var mailboxes = req.params.mailboxes;
	var currency = req.params.currency;
	var domainName = req.params.domainName;
	var period = req.params.period;
	var fullname = req.params.fullname;

	var Sales = Parse.Object.extend("sales");
	var query = new Parse.Query(Sales);

	query.equalTo('objectId', id);
	query.first({
		success: function(sale){
			var queryCompany = new Parse.Query('companies');
			queryCompany.equalTo('companyId', companyId);
			queryCompany.find({
				success: function(data){
					var internalId = data[0].get('internalId');
					var credentialsEncoded = new Buffer(config.InvoiceAPI_USER + ':' + config.InvoiceAPI_PWD).toString('base64');
					var oauth = 'Basic ' + credentialsEncoded;
					var now = new Date().getTime();
					now = moment(now).format('DD/MM/Y');
					var keys = Object.keys(mailboxes);
					var items = {};
					keys.forEach(function(mailbox, index){
						Reflect.deleteProperty(mailboxes[mailbox], "total");
						Reflect.deleteProperty(mailboxes[mailbox], "id");
						items[index] = mailboxes[mailbox];
					});

					Parse.Cloud.httpRequest({
						url: config.InvoiceAPI_CREATE_URL,
						method: 'POST',
						headers: {
							'Content-Type': 'application/json',
							'Authorization': oauth
						},
						body: {
							"invoice":{
								"subject": "Aumento de casillas del dominio: " + domainName,
							    "company_id": internalId,
							    "number": "",
							    "active_date": now,
							    "due_days": "30",
							    "currency": currency,
							    "taxed": config.InvoiceAPI_REQUIRETAX,
							    "invoice_items_attributes": items
							}
						},
						success: function(onSuccess){
							var urlInvoice = onSuccess.data.url;
							sale.save(null, {
								success: function() {
									var template = 'index.html';
									var vars = {
										adminEmail: sale.get('adminEmail'),
										sales: saleString,
										domain: sale.get('domainName'),
										total,
										url: urlInvoice,
										label: 'Ver Factura Online',
										period,
										fullname
									}

									sendEmail(template, vars).then(function(resolve){
										res.success(resolve);
									}).catch(function(error){
										res.success(resolve);
									});
								}
							});
						},
						error: function(onError){
							var errorMessage = onError.data.error.message
							var template = 'error.html';
							var vars = {
								adminEmail: sale.get('adminEmail'),
								sales: saleString,
								domain: sale.get('domainName'),
								total,
								period,
								errorMessage,
								fullname
							}

							sendEmail(template, vars, {
								from: '"Manager ZBox Ventas \u274C" <notreplay@zboxapp.com>',
								subject: 'Ocurrio un error en una compra desde Manager Zbox',
								to: config.EmailAPI_NOTIFICATIONS_ERROR
							}).then(function(resolve){
								res.success(resolve);
							}).catch(function(error){
								res.success(resolve);
							});
						}
					});
				},
				error: function(data, err){
					res.error(err);
				}
			});
		},
		error: function(error){
			res.error(error);
		}
	})
});

Parse.Cloud.define('saveSaleFromZboxManager', function(req, res){
	var Sales = Parse.Object.extend("sales");
	var SalesTable = new Sales();

	SalesTable.save(req.params, {
		useMasterKey: true,
		success: function(attrs){
			var adminEmail = req.params.adminEmail;
			var domain = req.params.domainName;
			var items = req.params.items;
			var currency = req.params.currency;
			var sales = req.params.description;
			var period = req.params.period;
			var fullname = req.params.fullname;
			var total = getTotalSales(items, currency);
			var template = 'customer.html';

			var vars = {
				adminEmail,
				sales,
				domain,
				total,
				period
			}

			sendEmail(template, vars, {to: adminEmail}).then(function(resolve){
				res.success(attrs);
			}).catch(function(error){
				res.success(attrs);
			});
		},
		error: function(attrs, error){
			res.error(error);
		}
	});
});

Parse.Cloud.define('makeSale', function(req, res){
	var zimbra = initZimbra();
	var domainId = req.params.domainId;
	var companyId = req.params.companyId;
	var adminMail = req.params.adminEmail;
	var items = req.params.items;
	var isUpgraded = req.params.upgrade;
	var currency = req.params.currency;
	var invoiced = false;
	req.params.invoiced = invoiced;
	var planKeys = Object.keys(items);

	if(planKeys.length < 1) {
		res.error({code: 404, message: 'Plans are missing, please check it out'});
	}

	checkAccount(adminMail, domainId).then(function(results){
		var domain = results.domain;
		var user = results.account;
		var userAttrs = user.attrs;
		var fullname = userAttrs.displayName ? userAttrs.displayName : (userAttrs.givenName || '[Sin Nombre]') + ' ' + (userAttrs.sn || '[Sin Apellido]');
		if (!companyId) {
			req.params.companyId = companyId = domain.attrs.businessCategory;
		}
		var domainName = domain.name;
		var nextPaymentDate = moment(domain.attrs.zimbraCreateTimestamp).format('MM/DD/Y');
		nextPaymentDate = getNextPaymentDate(nextPaymentDate);
		nextPaymentDate = moment(nextPaymentDate).format('DD/MM/Y');
		req.params.domainName = domainName;
		var zimbraDomainCOSMaxAccounts = domain.attrs.zimbraDomainCOSMaxAccounts;
		var zimbraDomainCOSMaxAccounts = typeof zimbraDomainCOSMaxAccounts === 'string' ? zimbraDomainCOSMaxAccounts.split() : zimbraDomainCOSMaxAccounts || [];
		var zimbraDomainMaxAccounts = domain.attrs.zimbraDomainMaxAccounts > 0 ? parseInt(domain.attrs.zimbraDomainMaxAccounts, 10) : 0;
		var toObjectCOS = {};
		var sale = '';

		// become array cos to object cos, to handle better.
		zimbraDomainCOSMaxAccounts.forEach(function(cos){
			var _from = cos.indexOf(':');
			if (_from > -1) {
				id = cos.substr(0, _from);
				size = parseInt(cos.substr(_from + 1));
				toObjectCOS[id] = size;
			}
		});

		// modify number of account if exits, or adding it to object.
		var description = '';
		planKeys.forEach(function(plan){
			var id = items[plan].id;
			var size = items[plan].quantity;
			var total = items[plan].total;

			if (toObjectCOS[id]) {
				toObjectCOS[id] += size;
			} else {
				toObjectCOS[id] = size;
			};

			var label = size > 1 ? 'Casillas' : 'Casilla' ;

			if (isUpgraded) {
				description = items[plan].description;
			} else {
				description += size + ' ' + label + ' ' + plan + ', ';
			}

			zimbraDomainMaxAccounts += size;
		});

		if (!isUpgraded) {
			description = description.substr(0, description.length - 2);
		}

		// get the keys from array cos, getting from Zimbra.
		var toObjectCOSKeys = Object.keys(toObjectCOS);

		// create array to save it in zimbra.
		zimbraDomainCOSMaxAccounts = toObjectCOSKeys.map(function(id){
			return id + ':' + toObjectCOS[id];
		});

		var attrs = {
			zimbraDomainMaxAccounts,
			zimbraDomainCOSMaxAccounts
		};

		// update cos in Zimbra.
		updatePlans(domain.id, attrs).then(function(success){
			req.params.period = 'Desde ' + moment(new Date()).format('DD/MM/Y') + ' - Hasta ' +nextPaymentDate;
			req.params.description = description;
			req.params.fullname = fullname;
			clearCacheZimbra(domainName).then(function(cleared){
				Parse.Cloud.run('saveSaleFromZboxManager', req.params).then(function(result){
					res.success(result);
				}).catch(function(error){
					res.error(error);
				});
			}).catch(function(err){
				Parse.Cloud.run('saveSaleFromZboxManager', req.params).then(function(result){
					res.success(result);
				}).catch(function(error){
					res.error(error);
				});
			});
		}).catch(function(error){
			res.error(error);
		});
	}).catch(function(err){
		res.error(err);
	});
});

Parse.Cloud.define('migratingDomainsFromZimbra', function(req, res){
	var zimbra = initZimbra();

	zimbra.then(function(zimbraAPI){
		zimbraAPI.getAllDomains(function(err, domains){
			if (err) {
				return res.error(err);
			}

			var allDomains = domains.domain;

			allDomains = allDomains.filter(function(domain){
				return !domain.isAliasDomain && !domain.name.match(/.archive$/gi);
			});

			var Domains = Parse.Object.extend('domains');

			var domainsBatch = allDomains.map(function(domain){
				var DomainsTable = new Domains();
				DomainsTable.set('domainId', domain.id);
				DomainsTable.set('name', domain.name);
				DomainsTable.set('companyId', domain.attrs.businessCategory);
				DomainsTable.set('zimbraCreateTimestamp', domain.attrs.zimbraCreateTimestamp);
				DomainsTable.set('zimbraDomainStatus', domain.attrs.zimbraDomainStatus);
				DomainsTable.set('zimbraDomainStatus', domain.attrs.zimbraDomainStatus);
				DomainsTable.set('isAnual', true);
				return DomainsTable;
			});

			Parse.Cloud.useMasterKey();
			Parse.Object.saveAll(domainsBatch, {
				success: function(response){
					res.success(response);
				},
				error: function(err){
					res.error(err);
				}
			});
		});
	}).catch(function(err){
		res.error(err);
	});
});

Parse.Cloud.define('getConfigManager', function(req, res){
	var app = req.params.target;

	app = app ? app.trim() : app;

	if (app === '' || !app) {
		return res.error({code: 404, message: 'You must to provide a target to get its config.'})
	}

	var Sales = Parse.Object.extend("configurationManager");
	var query = new Parse.Query(Sales);

	query.equalTo('app', app);
	query.find({
		success: function(config){
			if (config && config.length > 0) {
				var configuration = config[0].get('options');
				return res.success(configuration);
			}

			return res.error({code: 404, 'message': app + ', not found params.'});
		},
		error: function(err){
			res.error({original: err, code: 404, message: 'Your config for ' + app + ', was not found.'});
		}
	});
});

Parse.Cloud.define('migratingCompanies', function(req, res){
	var credentialsEncoded = new Buffer(config.InvoiceAPI_USER + ':' + config.InvoiceAPI_PWD).toString('base64');
	var oauth = 'Basic ' + credentialsEncoded;

	if (!oauth) {
		return res.error({'message': 'your account is not logged'});
	}

	Parse.Cloud.httpRequest({
		url: config.InvoiceAPI_LIST_URL,
		method: 'GET',
		headers: {
			'Content-Type': 'application/json',
			'Authorization': oauth
		},
		success: function(data){
			Parse.Cloud.useMasterKey();
			var Company = Parse.Object.extend('companies');
			var companies = data.data;
			var pos = Object.keys(companies);

			var companyBatch = pos.map(function(pos){
				var CompanyTable = new Company();
				CompanyTable.set('companyId', companies[pos].id);
				CompanyTable.set('internalId', companies[pos].internalId);
				CompanyTable.set('name', companies[pos].name);
				return CompanyTable;
			});

			Parse.Object.saveAll(companyBatch, {
				success: function(response){
					res.success(response);
				},
				error: function(err){
					res.error(err);
				}
			});
		},
		error: function(err){
			res.error(err);
		}
	});
});