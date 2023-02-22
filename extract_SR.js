// "plotSet" should point to the table imported, above.
var plotSet = FFC_plots_SFinland;

// This script imports a point-shapefile (.shp) from GEE assets, as a table (also
// pointed by "plotSet"). This table contains
// the location of the forest plots.
// For example, a csv that was used to generate such a shapefile could start
// with the following lines:
// 
// plot_id,m_date,lon,lat
// P1,2019-05-10,23.339927,62.276956
// P2,2019-08-11,23.339927,62.276956
// P3,2019-06-05,23.694864,60.437815
// P4,2019-07-20,26.563850,62.303880
// P5,2019-08-01,26.563850,62.303880
// ...
//
// Here, plot_id is the ID associated with the forest plot. It can be any string,
// but each line should have a unique plot_id. These plots are best thought of as
// 'temporary plots'. For example, if a permanent plot at a given location is measured
// twice (eg, in 2014 and in 2018), it would appear as two seperate 'temporary plots',
// with the same location but different measurement dates.
// And, m_date is its measurement date (should be in YYYY-MM-DD format). Then, (lon, lat)
// is the location co-ordinates of the plot.
// A point shapefile (.shp) should be generated from a similar csv
// (eg, using QGIS). Then, it should be imported as an asset into GEE, and imported here. 
// The important thing for this script is that the shapefile should
// have the two fields plot_id and m_date associated with each plot. 
// 

// ***************  HELPER FUNCTION BLOCK (BEGIN) ********************

// A wrapper function, for the 'map' function of GEE.
// This function returns a *function* ('wrap'). And 'wrap'
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
var getValsFromImage = function(img){
  
  // gets the values for the points in the current img
  var fc2 = img.reduceRegions(plotSet, ee.Reducer.first(), 30);
  // Discards null elements: Is crucial step!
  fc2 = fc2.filterMetadata('pixel_qa', 'not_equals', null);
  // Remove some unwanted properties, so that it is faster
  fc2 = removePropertyFromFeatureCollection(fc2, 'lat');
  fc2 = removePropertyFromFeatureCollection(fc2, 'lon');
  fc2 = removePropertyFromFeatureCollection(fc2, 'radsat_qa');
  fc2 = removePropertyFromFeatureCollection(fc2, 'sr_aerosol');
  // Now, add in some properties
  fc2 = fc2.map(setPropertiesFromImage(img, "LANDSAT_ID", "Landsat_ID"));
  fc2 = fc2.map(setPropertiesFromImage(img, "SENSING_TIME", "Acquisition_date_time"));
  var i_Date = ee.Date(img.get('system:time_start'));
  var fc3 = fc2.filter(ee.Filter.dateRangeContains('daterange', i_Date));
  fc3 = removePropertyFromFeatureCollection(fc3, 'daterange'); // no longer needed
  return (fc3);
}

// Generic Function to remove a property from a feature. From:
// https://gis.stackexchange.com/questions/321724/removing-property-from-feature-or-featurecollection-using-google-earth-engine
var removeProperty = function(feat, property) {
  var properties = feat.propertyNames();
  var selectProperties = properties.filter(ee.Filter.neq('item', property));
  return feat.select(selectProperties);
}
// remove property in each feature
var removePropertyFromFeatureCollection = function(FC, propString){
  var newFC = FC.map(function(feat) {
    return removeProperty(feat, propString)
  });
  return newFC;
}

// ***************   HELPER FUNCTION BLOCK (END)  ********************

// Center Map to the plot set
Map.centerObject(plotSet,7);
Map.addLayer(plotSet)

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

// Define the set of Landsat images that should be intersected
// with the plots.
// Here, the line 'filter(ee.Filter.calendarRange(6, 8, 'month'))'
// specifies that we want images acquired during the months of 
// June, July and August (hence, 6 to 8).
// The dataset used below is 'USGS Landsat 8 Surface Reflectance Tier 1'.
// See https://developers.google.com/earth-engine/datasets/catalog/LANDSAT_LC08_C01_T1_SR
var dataset = ee.ImageCollection('LANDSAT/LC08/C01/T1_SR')
                  // select images that spatially intersect with plotSet
                  .filterBounds(plotSet)
                  .filterMetadata('IMAGE_QUALITY_OLI', 'equals', 9)
                  .filterDate('2019-01-01', '2019-12-31') // 2019 only
                  // Keep only images of certain months
                  // .filter(ee.Filter.calendarRange(6, 8, 'month'))
                  .map(maskL8sr);
// How many Landsat images do we have?
print (dataset.size())

// Specification of time window to use. For example, consider that "6 months"
// is specified below. Hence, for any given plot measurement date, satellite
// images aquired with a ±6 month window will be considered.
// timeWindowUnits: one of 'year', 'month' 'week', 'day', 'hour', 'minute', or 'second'
// See here: https://developers.google.com/earth-engine/apidocs/ee-date-advance
var timeWindow = 6;
var timeWindowUnits = 'month';

// ********** BLOCK: SEE SOME OF THOSE IMAGES (BEGIN) ************* 
// If you want to see what one of these images look like
var listOfImages = dataset.toList(dataset.size());
var visParams = {
  bands: ['B4', 'B3', 'B2'],
  min: 0,
  max: 3000,
  gamma: 1.4,
  };
// This displays the first image of "dataset"
Map.addLayer(ee.Image(listOfImages.get(0)), visParams);
//
// ********** BLOCK: SEE SOME OF THOSE IMAGES (END) ************* 

// Add a new field 'daterange' to each plot in plotSet
plotSet = plotSet.map(function(fc){
  var fc_date = ee.Date(fc.get('m_date'));
  return fc.set('daterange',ee.DateRange(fc_date.advance(-1*timeWindow,timeWindowUnits), fc_date.advance(timeWindow,timeWindowUnits)))
});
//print (plotSet);

var makeFC = function(){
  // Essentially, execute function "getValsFromImage" on each element of "dataset"
  var newfc = ee.FeatureCollection((dataset.map(getValsFromImage)).flatten());
  return(newfc)
}

// Export the FeatureCollection to a CSV file.
// The created FeatureCollection will be exported to Google Drive,
// to a folder named 'GEE_Exports' (NOTE: create the folder beforehand).
// Here, pts_intWithImgs means: "points,
// intersected with (appropriate) images".
Export.table.toDrive({
  collection: ee.FeatureCollection(makeFC()),
  folder: 'GEE_Exports',
  description:'pts_intWithImgs-2019',
  fileFormat: 'CSV'
});


