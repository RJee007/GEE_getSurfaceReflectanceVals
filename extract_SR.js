// This imports a table sp_GEE_6Yrs.shp from 'assets'.
// These represent 'plots'. Note that each plot is associated with
// a location and a 'measurement date'. This date is in the 'm_date' column.
// Hence, it may be better to think of these plots as 'temporary plots'.
// For example, if a permanent plot at a given location is measured twice (eg, in 
// 2014 and in 2018), it would appear as two seperate 'temporary plots',
// with the same location but different measurement dates.


// ***************  HELPER FUNCTION BLOCK (BEGIN) ********************

function getCols(tableMetadata) {
  print(tableMetadata.columns);
}

// Landsat 8 has a footprint (square) of 180 km. So, 90 km from center to edge.
// So 10 km is 1/9rd of the way.
var buffArea = function(feature) {
  return feature.buffer(-10*1000);
};

// A wrapper function, for the 'map' function of GEE.
// This function returns a function 'wrap'. And 'wrap'
// is such that it takes only one agrument, a FeatureCollection.
// Code adapted from:
// https://gis.stackexchange.com/questions/302760/imagecollection-map-with-multiple-input-function
// Here, imageProperty is the propery of the image, defined by GEE. For example,
// "CLOUD_COVER", "LANDSAT_ID" for Landsat8.
// And fc_propertyName is the field (property) name the user desires.
var setPropertiesFromImage = function(img, imageProperty, fc_propertyName) {
  var wrap = function(f_elem) {
      return (f_elem.set(fc_propertyName, img.get(imageProperty)));
  }
  return wrap
}

// For any given image, intersect it with the plot set.
// The intersection is based on both the location of the plot
// and the measurement date associated with the plot.
// That is, 'location' means that the plot should fall in the
// image footprint. And 'measurement date' means that the measurement
// date of the plot should be 'near' the aquisition time of the image.
// In this context, 'near' could mean ± 1 month, ± 1 year, etc.
var getValsFromImage = function(img, fc){
  var inift = ee.FeatureCollection(fc);
  // gets the values for the points in the current img
  var fc2 = img.reduceRegions(sp_GEE_6Yrs, ee.Reducer.first(), 30);
  // Discards null elements: Is crucial step!
  fc2 = fc2.filterMetadata('pixel_qa', 'not_equals', null);
  fc2 = fc2.map(setPropertiesFromImage(img, "LANDSAT_ID", "Landsat_ID"));
  fc2 = fc2.map(setPropertiesFromImage(img, "SENSING_TIME", "Acquisition_date_time"));
  var i_Date = ee.Date(img.get('system:time_start'));
  var fc3 = fc2.filter(ee.Filter.dateRangeContains('daterange', i_Date));
  return inift.merge(fc3);
}

// Generic Function to remove a property from a feature. From:
// https://gis.stackexchange.com/questions/321724/removing-property-from-feature-or-featurecollection-using-google-earth-engine
var removeProperty = function(feat, property) {
  var properties = feat.propertyNames();
  var selectProperties = properties.filter(ee.Filter.neq('item', property));
  return feat.select(selectProperties);
}
// remove property color in each feature
var removePropertyFromFeatureCollection = function(FC, propString){
  var newFC = FC.map(function(feat) {
    return removeProperty(feat, propString)
  });
  return newFC;
}

// ***************   HELPER FUNCTION BLOCK (END)  ********************

// https://developers.google.com/earth-engine/datasets/catalog/USDOS_LSIB_SIMPLE_2017
var allCountries = ee.FeatureCollection("USDOS/LSIB_SIMPLE/2017")

//Choose country using GEE Feature Collection 
var roi = allCountries.filterMetadata('country_na', 'equals', 'Finland')
//print(roi)
var roi = roi.map(buffArea)

// Center Map to the Region of Interest
Map.centerObject(roi,7);
// Map.addLayer(roi)

// The dataset used is 'USGS Landsat 8 Surface Reflectance Tier 1'.
// See: https://developers.google.com/earth-engine/datasets/catalog/LANDSAT_LC08_C01_T1_SR
function maskL8sr(image) {
  // Bits 3 and 5 are cloud shadow and cloud, respectively.
  var cloudShadowBitMask = (1 << 3);
  var cloudsBitMask = (1 << 5);
  // Get the pixel QA band.
  var qa = image.select('pixel_qa');
  // Both flags should be set to zero, indicating clear conditions.
  var mask = qa.bitwiseAnd(cloudShadowBitMask).eq(0)
                 .and(qa.bitwiseAnd(cloudsBitMask).eq(0));
  return image.updateMask(mask);
}

// Here, the line 'filter(ee.Filter.calendarRange(5, 10, 'month'))'
// specifies that we want images acquired during the months of 
// May, June...October (hence, 5 to 10).
// See https://developers.google.com/earth-engine/datasets/catalog/LANDSAT_LC08_C01_T1_SR
var dataset = ee.ImageCollection('LANDSAT/LC08/C01/T1_SR')
                  .filterBounds(roi)
                  .filterMetadata('IMAGE_QUALITY_OLI', 'equals', 9)
                  .filterDate('2019-01-01', '2019-12-31') // just 2019, for now
                  // Select months needed
                  .filter(ee.Filter.calendarRange(6, 8, 'month'))
                  .map(maskL8sr);
                  
print (dataset.size())

// Specification of time window to use.
// For example, consider that "6 months" is specified below. Hence, for any
// given plot measurement date, satellite images aquired with a ±6 month window
// will be considered.
// timeWindowUnits: one of 'year', 'month' 'week', 'day', 'hour', 'minute', or 'second'
// See here: https://developers.google.com/earth-engine/apidocs/ee-date-advance
var timeWindow = 6;
var timeWindowUnits = 'month';

// ********** BLOCK: SEE SOME OF THOSE IMAGES (BEGIN) ************* 
//
// If you want to see what these images look like
// var listOfImages = dataset.toList(dataset.size());
// var visParams = {
//  bands: ['B4', 'B3', 'B2'],
//  min: 0,
//  max: 3000,
//  gamma: 1.4,
// };
//
// Map.addLayer(ee.Image(listOfImages.get(0)), visParams);
//
// ********** BLOCK: SEE SOME OF THOSE IMAGES (END) ************* 

// Adapted from code here:
// https://gis.stackexchange.com/questions/220062/google-earth-engine-how-to-get-cloud-cover-score-for-each-image-in-image-collec
var getCloudScores = function(img){
    //Get the cloud cover
    var landsatID = ee.Image(img).get('LANDSAT_ID');
    var ccl = ee.Image(img).get('CLOUD_COVER_LAND');
    var st  = ee.Image(img).get('SENSING_TIME');
    return ee.Feature(null, {'landsatID': landsatID, 'cloudCoverLand': ccl, 'sensingTime': st})
};

// var results = dataset.map(getCloudScores);
// print(results)

// Add a new field 'daterange' to each plot element.
sp_GEE_6Yrs = sp_GEE_6Yrs.map(function(fc){
  var fc_date = ee.Date(fc.get('m_date'));
  return fc.set('daterange',ee.DateRange(fc_date.advance(-1*timeWindow,timeWindowUnits), fc_date.advance(timeWindow,timeWindowUnits)))
});
//print (sp_GEE_6Yrs);

var makeFC = function(){
  // Define an empty Collection for the iterator to fill
  var empty_fc = ee.FeatureCollection(ee.List([]));
  var newfc = ee.FeatureCollection((dataset.map(getValsFromImage)).flatten()) ;
  return(newfc);
};

// Export the FeatureCollection to a CSV file.
// The created FeatureCollection will be exported to Google Drive,
// to a folder named 'GEE_Exports' (better create the folder beforehand).
// Here, pts_intWithImgs means: "points,
// intersected with (appropriate) images".
Export.table.toDrive({
  collection: ee.FeatureCollection(makeFC()),
  folder: 'GEE_Exports',
  description:'pts_intWithImgs-2019',
  fileFormat: 'CSV'
});


