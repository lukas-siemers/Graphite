const { FlatList } = require('react-native');
const React = require('react');

function DraggableFlatList(props) {
  return React.createElement(FlatList, props);
}
function ScaleDecorator({ children }) { return children; }
function OpacityDecorator({ children }) { return children; }

module.exports = { default: DraggableFlatList, DraggableFlatList, ScaleDecorator, OpacityDecorator };
